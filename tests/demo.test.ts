import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  magicLink: { create: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() },
  auditEvent: { findMany: vi.fn(), findFirst: vi.fn(), groupBy: vi.fn() },
  $queryRaw: vi.fn(),
}));
vi.mock("../src/lib/prisma.js", () => ({ prisma: db }));

const { createApp } = await import("../src/app.js");
const { env } = await import("../src/config/env.js");

const app = createApp();
const demoUser = { id: "u_demo", email: "demo@payflow.test", name: "Demo User", tenantId: "tenant_payflow" };

beforeEach(() => {
  vi.clearAllMocks();
  env.DEMO_LOGIN_EMAIL = undefined;
});

describe("GET /api/v1/auth/config", () => {
  it("reports the demo as disabled by default", async () => {
    const res = await request(app).get("/api/v1/auth/config");
    expect(res.body).toEqual({ demoEnabled: false });
  });

  it("reports it as enabled when DEMO_LOGIN_EMAIL is set", async () => {
    env.DEMO_LOGIN_EMAIL = "demo@payflow.test";
    const res = await request(app).get("/api/v1/auth/config");
    expect(res.body).toEqual({ demoEnabled: true });
  });
});

describe("POST /api/v1/auth/demo", () => {
  it("is a 404 and sets no cookie when the demo is disabled", async () => {
    const res = await request(app).post("/api/v1/auth/demo");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("DEMO_DISABLED");
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it("is a 404 when the configured demo user does not exist", async () => {
    env.DEMO_LOGIN_EMAIL = "demo@payflow.test";
    db.user.findUnique.mockResolvedValue(null);
    const res = await request(app).post("/api/v1/auth/demo");
    expect(res.status).toBe(404);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("signs in as the configured user only, ignoring any email in the request", async () => {
    env.DEMO_LOGIN_EMAIL = "Demo@PayFlow.test";
    db.user.findUnique.mockResolvedValue(demoUser);
    const res = await request(app).post("/api/v1/auth/demo").send({ email: "victim@acme.test" });
    expect(res.status).toBe(200);
    expect(db.user.findUnique).toHaveBeenCalledWith({ where: { email: "demo@payflow.test" } });
    expect(res.body.user.email).toBe("demo@payflow.test");
  });

  it("sets an httpOnly cookie whose lifetime is the short demo TTL, not the 7-day session", async () => {
    env.DEMO_LOGIN_EMAIL = "demo@payflow.test";
    db.user.findUnique.mockResolvedValue(demoUser);
    const res = await request(app).post("/api/v1/auth/demo");
    const cookie = (res.headers["set-cookie"] as unknown as string[])[0]!;
    expect(cookie).toContain("HttpOnly");
    const token = cookie.split(";")[0]!.split("=")[1]!;
    const claims = jwt.decode(token) as { exp: number; iat: number; tenantId: string };
    expect(claims.exp - claims.iat).toBe(env.DEMO_SESSION_HOURS * 3600);
    expect(claims.tenantId).toBe("tenant_payflow");
  });

  it("the demo session can read events of its own tenant", async () => {
    env.DEMO_LOGIN_EMAIL = "demo@payflow.test";
    db.user.findUnique.mockResolvedValue(demoUser);
    db.auditEvent.findMany.mockResolvedValue([]);
    const login = await request(app).post("/api/v1/auth/demo");
    const res = await request(app)
      .get("/api/v1/events")
      .set("Cookie", login.headers["set-cookie"] as unknown as string[]);
    expect(res.status).toBe(200);
    expect(db.auditEvent.findMany.mock.calls[0]![0].where.tenantId).toBe("tenant_payflow");
  });
});
