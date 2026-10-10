import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

// Gives every request an ID (echoed in the X-Request-Id header) so a user-reported error can be found in the logs.
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.header("x-request-id");
  const id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.locals.requestId = id;
  res.setHeader("X-Request-Id", id);
  next();
};

// One JSON line per request. Logs the PATH only: query strings can contain magic-link tokens.
export function createRequestLogger(write: (line: string) => void): RequestHandler {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    res.on("finish", () => {
      write(
        JSON.stringify({
          level: res.statusCode >= 500 ? "error" : "info",
          msg: "request",
          requestId: res.locals.requestId,
          method: req.method,
          path: req.baseUrl + req.path,
          status: res.statusCode,
          ms: Math.round(Number(process.hrtime.bigint() - start) / 1e5) / 10,
          tenantId: req.auth?.tenantId,
        }),
      );
    });
    next();
  };
}
