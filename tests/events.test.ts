import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const db = vi.hoisted(() => ({
  auditEvent: { findMany: vi.fn(), findFirst: vi.fn(), groupBy: vi.fn() },
  user: { findUnique: vi.fn() },
  magicLink: { create: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() },
  $queryRaw: vi.fn(),
}));
vi.mock("../src/lib/prisma.js", () => ({ prisma: db }));

const { createApp } = await import("../src/app.js");
const { signSession } = await import("../src/lib/sessions.js");
const { clearFacetsCache } = await import("../src/routes/events.js");
const { decodeCursor } = await import("../src/lib/events-query.js");

const app = createApp();
const cookie = (tenantId = "tenant_payflow") =>
  `auditrail_session=${signSession({ sub: "u1", tenantId, email: "a@b.com" })}`;

const makeRows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `evt_${String(i).padStart(4, "0")}`,
    tenantId: "tenant_payflow",
    createdAt: new Date(Date.UTC(2026, 9, 6, 10, 0, 0) - i * 1000),
    level: "INFO",
    service: "auth",
    actorId: "user_1",
    action: "user_login",
    message: "User signed in.",
    metadata: {},
  }));

beforeEach(() => {
  vi.clearAllMocks();
  clearFacetsCache();
});

describe("auth guard", () => {
  it.each(["/api/v1/events", "/api/v1/events/facets", "/api/v1/events/evt_1"])("%s requires a session", async (url) => {
    const res = await request(app).get(url);
    expect(res.status).toBe(401);
  });
});

describe("GET /api/v1/events", () => {
  it("scopes the query to the session tenant and ignores a tenantId in the query string", async () => {
    db.auditEvent.findMany.mockResolvedValue([]);
    const res = await request(app).get("/api/v1/events?tenantId=tenant_acme").set("Cookie", cookie("tenant_payflow"));
    expect(res.status).toBe(200);
    const args = db.auditEvent.findMany.mock.calls[0]![0];
    expect(args.where.tenantId).toBe("tenant_payflow");
    expect(args.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
    expect(args.take).toBe(26);
  });

  it("returns a nextCursor when more rows exist and trims the extra row", async () => {
    db.auditEvent.findMany.mockResolvedValue(makeRows(11));
    const res = await request(app).get("/api/v1/events?limit=10").set("Cookie", cookie());
    expect(res.body.data).toHaveLength(10);
    expect(res.body.nextCursor).toBeTruthy();
    expect(decodeCursor(res.body.nextCursor).id).toBe("evt_0009");
  });

  it("returns nextCursor null on the last page", async () => {
    db.auditEvent.findMany.mockResolvedValue(makeRows(3));
    const res = await request(app).get("/api/v1/events?limit=10").set("Cookie", cookie());
    expect(res.body.data).toHaveLength(3);
    expect(res.body.nextCursor).toBeNull();
  });

  it("uses the cursor for the next page", async () => {
    db.auditEvent.findMany.mockResolvedValueOnce(makeRows(11)).mockResolvedValueOnce([]);
    const first = await request(app).get("/api/v1/events?limit=10").set("Cookie", cookie());
    await request(app).get(`/api/v1/events?limit=10&cursor=${first.body.nextCursor}`).set("Cookie", cookie());
    const where = db.auditEvent.findMany.mock.calls[1]![0].where;
    expect(JSON.stringify(where.AND)).toContain("evt_0009");
  });

  it("passes filters through", async () => {
    db.auditEvent.findMany.mockResolvedValue([]);
    await request(app).get("/api/v1/events?level=ERROR&service=payments&action=payment_failed").set("Cookie", cookie());
    expect(db.auditEvent.findMany.mock.calls[0]![0].where).toMatchObject({
      level: "ERROR",
      service: "payments",
      action: "payment_failed",
    });
  });

  it("rejects bad input with 400", async () => {
    for (const qs of ["limit=1000", "level=DEBUG", "cursor=garbage"]) {
      const res = await request(app).get(`/api/v1/events?${qs}`).set("Cookie", cookie());
      expect(res.status).toBe(400);
    }
  });
});

describe("GET /api/v1/events/:id", () => {
  it("returns the event, scoped to the tenant", async () => {
    db.auditEvent.findFirst.mockResolvedValue(makeRows(1)[0]);
    const res = await request(app).get("/api/v1/events/evt_0000").set("Cookie", cookie("tenant_payflow"));
    expect(res.status).toBe(200);
    expect(res.body.event.id).toBe("evt_0000");
    expect(db.auditEvent.findFirst).toHaveBeenCalledWith({ where: { id: "evt_0000", tenantId: "tenant_payflow" } });
  });

  it("returns 404 when not found (including other tenants' events)", async () => {
    db.auditEvent.findFirst.mockResolvedValue(null);
    const res = await request(app).get("/api/v1/events/evt_other").set("Cookie", cookie());
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("EVENT_NOT_FOUND");
  });
});

describe("GET /api/v1/events/facets", () => {
  it("returns distinct services/actions and caches per tenant", async () => {
    db.auditEvent.groupBy
      .mockResolvedValueOnce([{ service: "auth" }, { service: "payments" }])
      .mockResolvedValueOnce([{ action: "payment_failed" }]);
    const res = await request(app).get("/api/v1/events/facets").set("Cookie", cookie());
    expect(res.body).toEqual({
      levels: ["INFO", "WARN", "ERROR"],
      services: ["auth", "payments"],
      actions: ["payment_failed"],
    });
    await request(app).get("/api/v1/events/facets").set("Cookie", cookie());
    expect(db.auditEvent.groupBy).toHaveBeenCalledTimes(2); // 2 queries once, second request served from cache
  });
});
