import "dotenv/config";
import { randomBytes } from "node:crypto";
import { PrismaClient, Level, type Prisma } from "@prisma/client";

const prisma = new PrismaClient();

const TOTAL = Number(process.env.SEED_COUNT ?? 10000);
const USER_EMAIL = process.env.SEED_USER_EMAIL ?? "support@payflow.test";
const BATCH = 2000; // 2000 rows x 9 columns stays under Postgres' 32,767 bind-parameter limit
const DAYS = 30;

const PAYFLOW = "tenant_payflow";
const ACME = "tenant_acme";

// small deterministic RNG so every seed run produces similar data
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(42);
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)] as T;
const int = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const eventId = () => `evt_${randomBytes(6).toString("hex")}`;

type Template = {
  action: string;
  level: Level;
  service: string;
  weight: number;
  message: () => string;
  metadata: () => Record<string, unknown>;
};

const declineReasons = ["card_declined", "insufficient_funds", "expired_card", "do_not_honor"] as const;
const providers = ["stripe", "razorpay", "adyen"] as const;
const currencies = ["INR", "USD", "EUR"] as const;
const endpoints = ["/v1/charges", "/v1/refunds", "/v1/orders", "/v1/invoices"] as const;

const templates: Template[] = [
  {
    action: "payment_completed", level: Level.INFO, service: "payments", weight: 22,
    message: () => "Payment completed successfully.",
    metadata: () => ({ paymentId: `pay_${int(10000, 99999)}`, amount: int(100, 99900), currency: pick(currencies), provider: pick(providers) }),
  },
  {
    action: "payment_failed", level: Level.ERROR, service: "payments", weight: 6,
    message: () => "Payment failed for customer during card authorization.",
    metadata: () => ({ paymentId: `pay_${int(10000, 99999)}`, amount: int(100, 99900), currency: pick(currencies), provider: pick(providers), reason: pick(declineReasons) }),
  },
  {
    action: "user_login", level: Level.INFO, service: "auth", weight: 20,
    message: () => "User signed in.",
    metadata: () => ({ method: pick(["magic_link", "sso"] as const), ip: `10.0.${int(0, 255)}.${int(1, 254)}` }),
  },
  {
    action: "user_logout", level: Level.INFO, service: "auth", weight: 12,
    message: () => "User signed out.",
    metadata: () => ({ sessionId: `ses_${int(100000, 999999)}` }),
  },
  {
    action: "order_created", level: Level.INFO, service: "orders", weight: 14,
    message: () => "Order created.",
    metadata: () => ({ orderId: `ord_${int(10000, 99999)}`, items: int(1, 8), total: int(500, 250000), currency: pick(currencies) }),
  },
  {
    action: "order_cancelled", level: Level.WARN, service: "orders", weight: 4,
    message: () => "Order cancelled by customer.",
    metadata: () => ({ orderId: `ord_${int(10000, 99999)}`, reason: pick(["customer_request", "payment_timeout", "out_of_stock"] as const) }),
  },
  {
    action: "password_changed", level: Level.INFO, service: "auth", weight: 2,
    message: () => "Password changed.",
    metadata: () => ({ initiatedBy: pick(["user", "admin"] as const) }),
  },
  {
    action: "invoice_created", level: Level.INFO, service: "billing", weight: 8,
    message: () => "Invoice created.",
    metadata: () => ({ invoiceId: `inv_${int(10000, 99999)}`, amount: int(1000, 500000), currency: pick(currencies), dueInDays: pick([7, 14, 30] as const) }),
  },
  {
    action: "api_error", level: Level.ERROR, service: "gateway", weight: 5,
    message: () => "Upstream request failed with a server error.",
    metadata: () => ({ endpoint: pick(endpoints), statusCode: pick([500, 502, 503, 504] as const), latencyMs: int(200, 9000) }),
  },
  {
    action: "permission_denied", level: Level.WARN, service: "gateway", weight: 7,
    message: () => "Request blocked: missing required permission.",
    metadata: () => ({ endpoint: pick(endpoints), requiredScope: pick(["payments:write", "orders:read", "invoices:write"] as const) }),
  },
];

const weighted = templates.flatMap((t) => Array<Template>(t.weight).fill(t));
const actors = Array.from({ length: 2000 }, (_, i) => `user_${1000 + i}`);

function makeEvent(tenantId: string, now: number): Prisma.AuditEventCreateManyInput {
  const t = pick(weighted);
  return {
    id: eventId(),
    tenantId,
    createdAt: new Date(now - Math.floor(rand() * DAYS * 24 * 60 * 60 * 1000)),
    level: t.level,
    service: t.service,
    actorId: pick(actors),
    action: t.action,
    message: t.message(),
    metadata: t.metadata() as Prisma.InputJsonObject,
  };
}

async function insertBatches(tenantId: string, count: number) {
  const now = Date.now();
  let done = 0;
  while (done < count) {
    const size = Math.min(BATCH, count - done);
    await prisma.auditEvent.createMany({
      data: Array.from({ length: size }, () => makeEvent(tenantId, now)),
    });
    done += size;
    process.stdout.write(`\r${tenantId}: ${done.toLocaleString()} / ${count.toLocaleString()}`);
  }
  process.stdout.write("\n");
}

async function main() {
  console.log(`Seeding ${TOTAL.toLocaleString()} events for ${PAYFLOW} (+ a small ${ACME} tenant)...`);
  const started = Date.now();

  await prisma.auditEvent.deleteMany();
  await prisma.user.deleteMany();

  await prisma.user.createMany({
    data: [
      { email: USER_EMAIL, name: "PayFlow Support", tenantId: PAYFLOW },
      { email: "support@acme.test", name: "Acme Support", tenantId: ACME },
    ],
  });

  // fixed event from the design mockup, so the Event Detail screen matches
  await prisma.auditEvent.create({
    data: {
      id: "evt_9f81a2",
      tenantId: PAYFLOW,
      createdAt: new Date("2026-10-06T10:04:21+05:30"),
      level: Level.ERROR,
      service: "payments",
      actorId: "user_4821",
      action: "payment_failed",
      message: "Payment failed for customer during card authorization.",
      metadata: { paymentId: "pay_10492", amount: 1499, currency: "INR", provider: "stripe", reason: "card_declined" },
    },
  });

  await insertBatches(PAYFLOW, TOTAL);
  await insertBatches(ACME, 500);

  const [total, perLevel] = await Promise.all([
    prisma.auditEvent.count(),
    prisma.auditEvent.groupBy({ by: ["level"], _count: true }),
  ]);
  console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s. Total events: ${total.toLocaleString()}`);
  console.log(perLevel.map((l) => `${l.level}=${l._count}`).join("  "));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());