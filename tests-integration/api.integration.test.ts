import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { PrismaClient, Level } from "@prisma/client";

const sendMail = vi.hoisted(() => vi.fn());
vi.mock("../src/lib/mailer.js", () => ({ sendMagicLinkEmail: sendMail }));

const { createApp } = await import("../src/app.js");
const { signSession } = await import("../src/lib/sessions.js");
const { generateToken, hashToken } = await import("../src/lib/tokens.js");

const prisma = new PrismaClient();
const app = createApp();

const A = "tenant_a";
const B = "tenant_b";
const cookieFor = (tenantId: string) => `auditrail_session=${signSession({ sub: "u", tenantId, email: "x@y.com" })}`;

type Row = { id: string; createdAt: Date };
let tenantARows: Row[] = [];

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  sendMail.mockClear();
  await prisma.magicLink.deleteMany();
  await prisma.user.deleteMany();
  await prisma.auditEvent.deleteMany();

  // 40 events for tenant A in only 5 distinct timestamps => 8 events share each timestamp,
  // so every page boundary below lands inside a group of identical timestamps.
  const base = Date.UTC(2026, 9, 1, 12, 0, 0);
  tenantARows = Array.from({ length: 40 }, (_, i) => ({
    id: `evt_a_${String(i).padStart(3, "0")}`,
    createdAt: new Date(base - Math.floor(i / 8) * 60_000),
  }));
  await prisma.auditEvent.createMany({
    data: tenantARows.map((r, i) => ({
      id: r.id,
      tenantId: A,
      createdAt: r.createdAt,
      level: i % 5 === 0 ? Level.ERROR : Level.INFO,
      service: i % 2 === 0 ? "payments" : "auth",
      actorId: `user_${i % 4}`,
      action: i % 2 === 0 ? "payment_failed" : "user_login",
      message: i === 7 ? "Card was DECLINED by issuer" : "ordinary event",
      metadata: { i },
    })),
  });
  await prisma.auditEvent.createMany({
    data: Array.from({ length: 5 }, (_, i) => ({
      id: `evt_b_${i}`,
      tenantId: B,
      level: Level.INFO,
      service: "payments",
      actorId: "user_b",
      action: "payment_completed",
      message: "tenant B secret",
      metadata: {},
    })),
  });
});

async function pageThrough(cookie: string, query: string, limit: number) {
  const ids: string[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 50; guard++) {
    const qs = new URLSearchParams(query);
    qs.set("limit", String(limit));
    if (cursor) qs.set("cursor", cursor);
    const res = await request(app).get(`/api/v1/events?${qs}`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    ids.push(...res.body.data.map((e: { id: string }) => e.id));
    cursor = res.body.nextCursor;
    if (!cursor) return ids;
  }
  throw new Error("pagination did not terminate");
}

describe("keyset pagination (real Postgres)", () => {
  it("returns every row exactly once, in order, across pages that split identical timestamps", async () => {
    const ids = await pageThrough(cookieFor(A), "", 7);
    const expected = [...tenantARows]
      .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime() || (x.id < y.id ? 1 : -1))
      .map((r) => r.id);
    expect(ids).toHaveLength(40);
    expect(new Set(ids).size).toBe(40);
    expect(ids).toEqual(expected);
  });

  it("works for every page size, including sizes that land exactly on a group boundary", async () => {
    for (const limit of [1, 3, 8, 16, 40, 100]) {
      const ids = await pageThrough(cookieFor(A), "", limit);
      expect(new Set(ids).size, `limit=${limit}`).toBe(40);
    }
  });

  it("paginates filtered results too", async () => {
    const ids = await pageThrough(cookieFor(A), "level=ERROR", 3);
    expect(ids).toHaveLength(8); // i = 0,5,10,...,35
  });
});

describe("filters (real Postgres)", () => {
  it("search is case-insensitive on message", async () => {
    const res = await request(app).get("/api/v1/events?q=declined").set("Cookie", cookieFor(A));
    expect(res.body.data.map((e: { id: string }) => e.id)).toEqual(["evt_a_007"]);
  });

  it("search matches actor prefix and event id prefix", async () => {
    const byActor = await request(app).get("/api/v1/events?q=USER_1&limit=100").set("Cookie", cookieFor(A));
    expect(byActor.body.data.length).toBe(10);
    const byId = await request(app).get("/api/v1/events?q=evt_a_00").set("Cookie", cookieFor(A));
    expect(byId.body.data.length).toBe(10);
  });

  it("combines service + action + level", async () => {
    const res = await request(app)
      .get("/api/v1/events?service=payments&action=payment_failed&level=ERROR&limit=100")
      .set("Cookie", cookieFor(A));
    expect(res.body.data.length).toBe(4); // i = 0,10,20,30
  });

  it("facets list distinct values for the tenant only", async () => {
    const res = await request(app).get("/api/v1/events/facets").set("Cookie", cookieFor(B));
    expect(res.body.actions).toEqual(["payment_completed"]);
  });
});

describe("tenant isolation (real Postgres)", () => {
  it("tenant B never sees tenant A rows, and a tenantId query param is ignored", async () => {
    const ids = await pageThrough(cookieFor(B), `tenantId=${A}`, 100);
    expect(ids).toHaveLength(5);
    expect(ids.every((id) => id.startsWith("evt_b_"))).toBe(true);
  });

  it("another tenant's event detail is a 404", async () => {
    const own = await request(app).get("/api/v1/events/evt_a_000").set("Cookie", cookieFor(A));
    expect(own.status).toBe(200);
    const cross = await request(app).get("/api/v1/events/evt_a_000").set("Cookie", cookieFor(B));
    expect(cross.status).toBe(404);
  });
});

describe("magic-link flow (real Postgres)", () => {
  async function newUser() {
    return prisma.user.create({ data: { email: "dev@payflow.test", name: "Dev", tenantId: A } });
  }

  it("request → verify → /me → logout; the link is single-use", async () => {
    await newUser();
    const req = await request(app).post("/api/v1/auth/magic-link").send({ email: "Dev@PayFlow.test" });
    expect(req.status).toBe(202);

    const token = new URL(sendMail.mock.calls[0]![1] as string).searchParams.get("token")!;
    const stored = await prisma.magicLink.findUnique({ where: { tokenHash: hashToken(token) } });
    expect(stored).not.toBeNull();
    expect(stored!.tokenHash).not.toBe(token);

    const verify = await request(app).post("/api/v1/auth/verify").send({ token });
    expect(verify.status).toBe(200);
    const cookie = (verify.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;

    const me = await request(app).get("/api/v1/auth/me").set("Cookie", cookie);
    expect(me.body.user.email).toBe("dev@payflow.test");

    const again = await request(app).post("/api/v1/auth/verify").send({ token });
    expect(again.status).toBe(401);
  });

  it("only the newest link works; expired links are rejected", async () => {
    await newUser();
    await request(app).post("/api/v1/auth/magic-link").send({ email: "dev@payflow.test" });
    await request(app).post("/api/v1/auth/magic-link").send({ email: "dev@payflow.test" });
    const first = new URL(sendMail.mock.calls[0]![1] as string).searchParams.get("token")!;
    const second = new URL(sendMail.mock.calls[1]![1] as string).searchParams.get("token")!;
    expect((await request(app).post("/api/v1/auth/verify").send({ token: first })).status).toBe(401);

    await prisma.magicLink.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await request(app).post("/api/v1/auth/verify").send({ token: second })).status).toBe(401);
  });

  it("two simultaneous verifies of one token: exactly one succeeds", async () => {
    const user = await newUser();
    const token = generateToken();
    await prisma.magicLink.create({
      data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 60_000) },
    });
    const results = await Promise.all([
      request(app).post("/api/v1/auth/verify").send({ token }),
      request(app).post("/api/v1/auth/verify").send({ token }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
  });
});
