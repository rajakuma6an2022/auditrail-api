import dotenv from "dotenv";
import { randomBytes } from "node:crypto";
import { PrismaClient, Level, type Prisma } from "@prisma/client";

dotenv.config({ path: ".env.performance", override: true });

const url = process.env.PERF_DATABASE_URL;
if (!url) throw new Error("PERF_DATABASE_URL is missing.");

const parsedUrl = new URL(url);
const EXPECTED_HOST = "ep-soft-water-b3i5j4vm-pooler.c-4.ap-southeast-1.aws.neon.tech";

if (
  parsedUrl.protocol !== "postgresql:" ||
  parsedUrl.hostname !== EXPECTED_HOST ||
  process.env.ALLOW_PERF_SEED !== "true"
) {
  throw new Error("Seed blocked. Verify the performance branch and explicitly enable it.");
}

process.env.DATABASE_URL = url;
process.env.DIRECT_URL = url;

const prisma = new PrismaClient();

const TARGET_COUNT = Number(process.env.PERF_SEED_COUNT ?? 10000);
const TENANT = process.env.PERF_TENANT_ID ?? "tenant_perf_benchmark";
const BATCH_SIZE = 1000;
const DAYS = 30;

const services = ["payments", "auth", "orders", "billing", "gateway"];
const actions = ["payment_completed", "payment_failed", "user_login", "order_created", "api_error"];
const levels = [Level.INFO, Level.INFO, Level.WARN, Level.ERROR];

function makeEvent(now: number): Prisma.AuditEventCreateManyInput {
  const action = actions[Math.floor(Math.random() * actions.length)];
  const level = levels[Math.floor(Math.random() * levels.length)];

  return {
    id: `perf_${randomBytes(12).toString("hex")}`,
    tenantId: TENANT,
    createdAt: new Date(now - Math.floor(Math.random() * DAYS * 24 * 60 * 60 * 1000)),
    level,
    service: services[Math.floor(Math.random() * services.length)],
    actorId: `perf_user_${Math.floor(Math.random() * 2000)}`,
    action,
    message: `Synthetic performance test event: ${action}`,
    metadata: {
      synthetic: true,
      benchmarkTenant: TENANT,
      requestId: randomBytes(8).toString("hex"),
    },
  };
}

async function main() {
  if (
    !Number.isSafeInteger(TARGET_COUNT) ||
    TARGET_COUNT < 1 ||
    TARGET_COUNT > 500000 ||
    !/^tenant_perf_[a-zA-Z0-9_]+$/.test(TENANT)
  ) {
    throw new Error("Invalid PERF_SEED_COUNT or PERF_TENANT_ID.");
  }

  const existing = await prisma.auditEvent.count({
    where: { tenantId: TENANT },
  });

  if (existing > TARGET_COUNT) {
    throw new Error(`Tenant ${TENANT} already has ${existing} events, above target ${TARGET_COUNT}.`);
  }

  const toInsert = TARGET_COUNT - existing;

  if (toInsert === 0) {
    console.log(`Target already reached: ${existing} events for ${TENANT}.`);
    return;
  }

  console.log(`Adding ${toInsert.toLocaleString()} events`);
  console.log(`Target: ${TARGET_COUNT.toLocaleString()} events for ${TENANT}`);
  console.log(`Synthetic tenant: ${TENANT}`);

  const started = Date.now();
  const now = Date.now();

  for (let done = 0; done < toInsert;) {
    const size = Math.min(BATCH_SIZE, toInsert - done);

    await prisma.auditEvent.createMany({
      data: Array.from({ length: size }, () => makeEvent(now)),
    });

    done += size;
    console.log(`${done.toLocaleString()} / ${toInsert.toLocaleString()}`);
  }

  const tenantCount = await prisma.auditEvent.count({
    where: { tenantId: TENANT },
  });
  const totalCount = await prisma.auditEvent.count();

  console.log(`Tenant events: ${tenantCount.toLocaleString()}`);
  console.log(`Total database events: ${totalCount.toLocaleString()}`);
  console.log(`Elapsed: ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main()
  .catch((error) => {
    console.error("Performance seed failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
