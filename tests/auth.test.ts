import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  magicLink: { create: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() },
  $queryRaw: vi.fn(),
}));
const sendMail = vi.hoisted(() => vi.fn());

vi.mock("../src/lib/prisma.js", () => ({ prisma: db }));
vi.mock("../src/lib/mailer.js", () => ({ sendMagicLinkEmail: sendMail }));

const { createApp } = await import("../src/app.js");
const { hashToken } = await import("../src/lib/tokens.js");

const app = createApp();
const user = { id: "u1", email: "support@payflow.test", name: "PayFlow Support", tenantId: "tenant_payflow" };
const future = () => new Date(Date.now() + 10 * 60 * 1000);
const past = () => new Date(Date.now() - 1000);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/v1/auth/magic-link", () => {
  it("rejects an invalid email with 400", async () => {
    const res = await request(app).post("/api/v1/auth/magic-link").send({ email: "nope" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a missing body with 400", async () => {
    const res = await request(app).post("/api/v1/auth/magic-link");
    expect(res.status).toBe(400);
  });

  it("returns 202 and sends nothing for an unknown email", async () => {
    db.user.findUnique.mockResolvedValue(null);
    const res = await request(app).post("/api/v1/auth/magic-link").send({ email: "ghost@x.com" });
    expect(res.status).toBe(202);
    expect(db.magicLink.create).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("stores only a hash and emails a link for a known email", async () => {
    db.user.findUnique.mockResolvedValue(user);
    const res = await request(app).post("/api/v1/auth/magic-link").send({ email: "  Support@PayFlow.test " });
    expect(res.status).toBe(202);
    expect(db.user.findUnique).toHaveBeenCalledWith({ where: { email: "support@payflow.test" } });

    const url: string = sendMail.mock.calls[0]![1];
    const token = new URL(url).searchParams.get("token")!;
    const stored = db.magicLink.create.mock.calls[0]![0].data;
    expect(stored.tokenHash).toBe(hashToken(token));
    expect(stored.tokenHash).not.toBe(token);
  });
});

describe("POST /api/v1/auth/verify", () => {
  it("rejects a malformed token with 400", async () => {
    const res = await request(app).post("/api/v1/auth/verify").send({ token: "short" });
    expect(res.status).toBe(400);
  });

  it("rejects an unknown token with 401", async () => {
    db.magicLink.findUnique.mockResolvedValue(null);
    const res = await request(app).post("/api/v1/auth/verify").send({ token: "x".repeat(40) });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_LINK");
  });

  it("rejects an expired token", async () => {
    db.magicLink.findUnique.mockResolvedValue({ id: "l1", usedAt: null, expiresAt: past(), user });
    const res = await request(app).post("/api/v1/auth/verify").send({ token: "x".repeat(40) });
    expect(res.status).toBe(401);
  });

  it("rejects an already used token", async () => {
    db.magicLink.findUnique.mockResolvedValue({ id: "l1", usedAt: new Date(), expiresAt: future(), user });
    const res = await request(app).post("/api/v1/auth/verify").send({ token: "x".repeat(40) });
    expect(res.status).toBe(401);
  });

  it("rejects when another request consumed the token first", async () => {
    db.magicLink.findUnique.mockResolvedValue({ id: "l1", usedAt: null, expiresAt: future(), user });
    db.magicLink.updateMany.mockResolvedValue({ count: 0 });
    const res = await request(app).post("/api/v1/auth/verify").send({ token: "x".repeat(40) });
    expect(res.status).toBe(401);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("signs in with a valid token and sets an httpOnly cookie", async () => {
    db.magicLink.findUnique.mockResolvedValue({ id: "l1", usedAt: null, expiresAt: future(), user });
    db.magicLink.updateMany.mockResolvedValue({ count: 1 });
    const res = await request(app).post("/api/v1/auth/verify").send({ token: "x".repeat(40) });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(user.email);
    const cookie = (res.headers["set-cookie"] as unknown as string[])[0]!;
    expect(cookie).toContain("auditrail_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
  });
});

describe("session endpoints", () => {
  it("GET /me without a cookie returns 401", async () => {
    const res = await request(app).get("/api/v1/auth/me");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("GET /me with a forged cookie returns 401", async () => {
    const res = await request(app).get("/api/v1/auth/me").set("Cookie", "auditrail_session=garbage");
    expect(res.status).toBe(401);
  });

  it("GET /me returns the user after sign-in", async () => {
    db.magicLink.findUnique.mockResolvedValue({ id: "l1", usedAt: null, expiresAt: future(), user });
    db.magicLink.updateMany.mockResolvedValue({ count: 1 });
    const login = await request(app).post("/api/v1/auth/verify").send({ token: "x".repeat(40) });
    const cookies = login.headers["set-cookie"] as unknown as string[];

    db.user.findUnique.mockResolvedValue(user);
    const res = await request(app).get("/api/v1/auth/me").set("Cookie", cookies);
    expect(res.status).toBe(200);
    expect(res.body.user.tenantId).toBe("tenant_payflow");
  });

  it("POST /logout clears the cookie", async () => {
    const res = await request(app).post("/api/v1/auth/logout");
    expect(res.status).toBe(204);
    const cookie = (res.headers["set-cookie"] as unknown as string[])[0]!;
    expect(cookie).toContain("auditrail_session=;");
  });
});