import type { RequestHandler } from "express";
import { AppError } from "../lib/errors.js";
import { SESSION_COOKIE, verifySession, type SessionPayload } from "../lib/sessions.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: SessionPayload;
    }
  }
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  const token = req.cookies?.[SESSION_COOKIE];
  const session = typeof token === "string" ? verifySession(token) : null;
  if (!session) {
    throw new AppError(401, "UNAUTHENTICATED", "You are not signed in.");
  }
  req.auth = session;
  next();
};