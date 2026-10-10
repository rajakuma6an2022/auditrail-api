import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createRequestLogger, requestId } from "../src/middleware/request-log.js";

function makeApp(lines: string[]) {
  const app = express();
  app.use(requestId);
  app.use(createRequestLogger((l) => lines.push(l)));
  app.get("/ping", (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe("request id", () => {
  it("generates an id and returns it in X-Request-Id", async () => {
    const res = await request(makeApp([])).get("/ping");
    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("keeps a safe incoming id", async () => {
    const res = await request(makeApp([])).get("/ping").set("X-Request-Id", "abc-12345678");
    expect(res.headers["x-request-id"]).toBe("abc-12345678");
  });

  it("replaces an unsafe incoming id (log injection)", async () => {
    const res = await request(makeApp([])).get("/ping").set("X-Request-Id", "x y<script>");
    expect(res.headers["x-request-id"]).not.toContain("<");
    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("request logger", () => {
  it("writes one JSON line with status and duration", async () => {
    const lines: string[] = [];
    await request(makeApp(lines)).get("/ping");
    await vi.waitFor(() => expect(lines).toHaveLength(1));
    const entry = JSON.parse(lines[0]!);
    expect(entry).toMatchObject({ msg: "request", method: "GET", path: "/ping", status: 200 });
    expect(typeof entry.ms).toBe("number");
  });

  it("never logs the query string (magic-link tokens)", async () => {
    const lines: string[] = [];
    await request(makeApp(lines)).get("/ping?token=SECRET123");
    await vi.waitFor(() => expect(lines).toHaveLength(1));
    expect(lines[0]).not.toContain("SECRET123");
  });
});
