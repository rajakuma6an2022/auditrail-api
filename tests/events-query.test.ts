import { describe, it, expect } from "vitest";
import { buildWhere, decodeCursor, encodeCursor, listQuerySchema } from "../src/lib/events-query.js";

const parse = (q: Record<string, unknown>) => listQuerySchema.parse(q);

describe("cursor", () => {
  it("round-trips createdAt and id", () => {
    const createdAt = new Date("2026-10-06T04:34:21.123Z");
    const decoded = decodeCursor(encodeCursor({ createdAt, id: "evt_abc" }));
    expect(decoded.id).toBe("evt_abc");
    expect(decoded.createdAt.getTime()).toBe(createdAt.getTime());
  });

  it.each(["", "not-base64-json", Buffer.from("123").toString("base64url"), Buffer.from("null").toString("base64url")])(
    "rejects garbage cursor %j",
    (raw) => {
      expect(() => decodeCursor(raw)).toThrow(/Invalid pagination cursor/);
    },
  );
});

describe("buildWhere", () => {
  it("always scopes by tenant", () => {
    expect(buildWhere("t1", parse({}))).toEqual({ tenantId: "t1" });
  });

  it("applies exact filters and time range", () => {
    const where = buildWhere(
      "t1",
      parse({ level: "ERROR", service: "payments", action: "payment_failed", from: "2026-10-01T00:00:00Z", to: "2026-10-02T00:00:00Z" }),
    );
    expect(where).toMatchObject({ tenantId: "t1", level: "ERROR", service: "payments", action: "payment_failed" });
    expect(where.createdAt).toEqual({ gte: new Date("2026-10-01T00:00:00Z"), lte: new Date("2026-10-02T00:00:00Z") });
  });

  it("adds a search OR over id, actor and message", () => {
    const where = buildWhere("t1", parse({ q: "user_4821" }));
    expect(JSON.stringify(where.AND)).toContain("actorId");
    expect(JSON.stringify(where.AND)).toContain("message");
  });

  it("adds keyset condition for a cursor", () => {
    const cursor = encodeCursor({ createdAt: new Date("2026-10-06T00:00:00Z"), id: "evt_x" });
    const where = buildWhere("t1", parse({ cursor }));
    expect(JSON.stringify(where.AND)).toContain('"lt"');
  });
});

describe("listQuerySchema", () => {
  it("defaults limit to 25", () => expect(parse({}).limit).toBe(25));
  it("caps limit at 100", () => expect(() => parse({ limit: "101" })).toThrow());
  it("rejects unknown levels", () => expect(() => parse({ level: "DEBUG" })).toThrow());
  it("rejects bad dates", () => expect(() => parse({ from: "yesterday" })).toThrow());
});