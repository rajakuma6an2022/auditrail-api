import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import { generateToken, hashToken } from "../lib/tokens.js";
import { sendMagicLinkEmail } from "../lib/mailer.js";
import {
  SESSION_COOKIE,
  clearCookieOptions,
  sessionCookieFor,
  sessionCookieOptions,
  signSession,
} from "../lib/sessions.js";
import { requireAuth } from "../middleware/auth.js";

export const authRouter = Router();

const magicLinkLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: () => env.NODE_ENV === "test",
  handler: (_req, res) => {
    res.status(429).json({
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests. Please try again in a few minutes.",
      },
    });
  },
});

const magicLinkBody = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
});

const verifyBody = z.object({
  token: z.string().min(20).max(200),
});

const toPublicUser = (u: { id: string; email: string; name: string; tenantId: string }) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  tenantId: u.tenantId,
});

// Always answers 202 so the endpoint cannot be used to discover which emails exist.
authRouter.post("/magic-link", magicLinkLimiter, async (req, res) => {
  const { email } = magicLinkBody.parse(req.body);

  const user = await prisma.user.findUnique({ where: { email } });
  if (user) {
    const token = generateToken();
    // only the newest link is valid
    await prisma.magicLink.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    await prisma.magicLink.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + env.MAGIC_LINK_TTL_MINUTES * 60 * 1000),
      },
    });
    try {
      await sendMagicLinkEmail(user.email, `${env.APP_URL}/auth/verify?token=${token}`);
    } catch (err) {
      // Never reveal (via a 5xx) that this email exists; log and answer the same 202.
      console.error("[mailer] failed to send magic link:", err);
    }
  }

  res.status(202).json({
    message: "If that email is registered, a sign-in link has been sent.",
  });
});

// POST (not GET) so email scanners that pre-fetch links cannot burn the one-time token.
authRouter.post("/verify", async (req, res) => {
  const { token } = verifyBody.parse(req.body);
  const invalid = new AppError(401, "INVALID_LINK", "This sign-in link is invalid or has expired.");

  const link = await prisma.magicLink.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!link || link.usedAt || link.expiresAt < new Date()) throw invalid;

  // atomic one-time use: only one concurrent request can flip usedAt from null
  const consumed = await prisma.magicLink.updateMany({
    where: { id: link.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (consumed.count !== 1) throw invalid;

  res.cookie(
    SESSION_COOKIE,
    signSession({
      sub: link.user.id,
      tenantId: link.user.tenantId,
      email: link.user.email,
    }),
    sessionCookieOptions,
  );
  res.json({ user: toPublicUser(link.user) });
});

const demoLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: () => env.NODE_ENV === "test",
  handler: (_req, res) => {
    res.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many requests. Please try again later." } });
  },
});

// Lets the login screen know whether to offer "Try the demo".
authRouter.get("/config", (_req, res) => {
  res.json({ demoEnabled: Boolean(env.DEMO_LOGIN_EMAIL) });
});

// Public read-only demo: signs in as ONE server-configured, synthetic-data user (the client cannot choose who).
// Off unless DEMO_LOGIN_EMAIL is set; the session is short-lived.
authRouter.post("/demo", demoLimiter, async (_req, res) => {
  const notEnabled = new AppError(404, "DEMO_DISABLED", "Demo login is not enabled.");
  const email = env.DEMO_LOGIN_EMAIL?.toLowerCase();
  if (!email) throw notEnabled;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw notEnabled;

  const ttl = env.DEMO_SESSION_HOURS * 60 * 60;
  res.cookie(
    SESSION_COOKIE,
    signSession({ sub: user.id, tenantId: user.tenantId, email: user.email }, ttl),
    sessionCookieFor(ttl),
  );
  res.json({ user: toPublicUser(user) });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.auth!.sub } });
  if (!user) {
    res.clearCookie(SESSION_COOKIE, clearCookieOptions);
    throw new AppError(401, "UNAUTHENTICATED", "You are not signed in.");
  }
  res.json({ user: toPublicUser(user) });
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(SESSION_COOKIE, clearCookieOptions);
  res.status(204).end();
});
