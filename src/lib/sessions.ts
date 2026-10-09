import jwt from "jsonwebtoken";
import type { CookieOptions } from "express";
import { env } from "../config/env.js";

export const SESSION_COOKIE = "auditrail_session";

export type SessionPayload = { sub: string; tenantId: string; email: string };

const maxAgeSeconds = env.SESSION_TTL_DAYS * 24 * 60 * 60;

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { algorithm: "HS256", expiresIn: maxAgeSeconds });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ["HS256"] });
    if (typeof decoded === "string") return null;
    const { sub, tenantId, email } = decoded;
    if (typeof sub !== "string" || typeof tenantId !== "string" || typeof email !== "string") return null;
    return { sub, tenantId, email };
  } catch {
    return null;
  }
}

const base: CookieOptions = {
  httpOnly: true,
  secure: env.isProd,
  sameSite: "lax",
  path: "/",
};

export const sessionCookieOptions: CookieOptions = { ...base, maxAge: maxAgeSeconds * 1000 };
export const clearCookieOptions: CookieOptions = base;