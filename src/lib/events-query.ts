import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { AppError } from "./errors.js";

export const LEVELS = ["INFO", "WARN", "ERROR"] as const;

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(300).optional(),
  level: z.enum(LEVELS).optional(),
  service: z.string().trim().min(1).max(64).optional(),
  action: z.string().trim().min(1).max(64).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});

export type ListQuery = z.infer<typeof listQuerySchema>;

// Cursor = position of the last row of the previous page (createdAt + id), base64url JSON.
export function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify({ t: row.createdAt.toISOString(), id: row.id })).toString("base64url");
}

export function decodeCursor(raw: string): { createdAt: Date; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    const createdAt = new Date(parsed.t);
    if (typeof parsed.id !== "string" || Number.isNaN(createdAt.getTime())) throw new Error("bad cursor");
    return { createdAt, id: parsed.id };
  } catch {
    throw new AppError(400, "INVALID_CURSOR", "Invalid pagination cursor.");
  }
}

// tenantId ALWAYS comes from the verified session, never from the request query.
export function buildWhere(tenantId: string, query: ListQuery): Prisma.AuditEventWhereInput {
  const where: Prisma.AuditEventWhereInput = { tenantId };
  const and: Prisma.AuditEventWhereInput[] = [];

  if (query.level) where.level = query.level;
  if (query.service) where.service = query.service;
  if (query.action) where.action = query.action;

  if (query.from || query.to) {
    where.createdAt = {
      ...(query.from ? { gte: new Date(query.from) } : {}),
      ...(query.to ? { lte: new Date(query.to) } : {}),
    };
  }

  if (query.q) {
    and.push({
      OR: [
        { id: { startsWith: query.q } },
        { actorId: { startsWith: query.q, mode: "insensitive" } },
        { message: { contains: query.q, mode: "insensitive" } },
      ],
    });
  }

  if (query.cursor) {
    const c = decodeCursor(query.cursor);
    and.push({
      OR: [{ createdAt: { lt: c.createdAt } }, { createdAt: c.createdAt, id: { lt: c.id } }],
    });
  }

  if (and.length > 0) where.AND = and;
  return where;
}
