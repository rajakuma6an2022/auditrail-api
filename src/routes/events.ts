import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { LEVELS, buildWhere, encodeCursor, listQuerySchema } from "../lib/events-query.js";

export const eventsRouter = Router();

eventsRouter.use(requireAuth);

eventsRouter.get("/", async (req, res) => {
  const query = listQuerySchema.parse(req.query);
  const where = buildWhere(req.auth!.tenantId, query);

  // fetch one extra row to know whether another page exists (no expensive COUNT)
  const rows = await prisma.auditEvent.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
  });

  const hasMore = rows.length > query.limit;
  const data = hasMore ? rows.slice(0, query.limit) : rows;
  const last = data[data.length - 1];

  res.json({ data, nextCursor: hasMore && last ? encodeCursor(last) : null });
});

// Filter dropdown options. Distinct scans are cached per tenant for 60s.
type Facets = { levels: readonly string[]; services: string[]; actions: string[] };
const facetsCache = new Map<string, { at: number; value: Facets }>();
const FACETS_TTL_MS = 60_000;

export function clearFacetsCache() {
  facetsCache.clear();
}

eventsRouter.get("/facets", async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const cached = facetsCache.get(tenantId);
  if (cached && Date.now() - cached.at < FACETS_TTL_MS) {
    res.json(cached.value);
    return;
  }

  const [services, actions] = await Promise.all([
    prisma.auditEvent.groupBy({ by: ["service"], where: { tenantId }, orderBy: { service: "asc" } }),
    prisma.auditEvent.groupBy({ by: ["action"], where: { tenantId }, orderBy: { action: "asc" } }),
  ]);

  const value: Facets = {
    levels: LEVELS,
    services: services.map((s: { service: string }) => s.service),
    actions: actions.map((a: { action: string }) => a.action),
  };
  facetsCache.set(tenantId, { at: Date.now(), value });
  res.json(value);
});

// Another tenant's event returns 404 (not 403) so event IDs cannot be probed across tenants.
eventsRouter.get("/:id", async (req, res) => {
  const id = req.params.id;
  if (!id || id.length > 64) throw new AppError(404, "EVENT_NOT_FOUND", "Event not found.");

  const event = await prisma.auditEvent.findFirst({ where: { id, tenantId: req.auth!.tenantId } });
  if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event not found.");

  res.json({ event });
});