import "dotenv/config";
import { PrismaClient, Level } from "@prisma/client";
import { hashToken } from "../src/lib/tokens.js";

// Deterministic data for the Playwright E2E suite (web repo). Refuses to touch anything but a local throwaway DB.
const url = new URL(process.env.DATABASE_URL ?? "postgresql://x/none");
const dbName = url.pathname.replace("/", "");
if (!["localhost", "127.0.0.1"].includes(url.hostname) || !/_(test|e2e)$/.test(dbName)) {
  console.error(
    `Refusing to seed ${url.hostname}/${dbName}: host must be localhost and the DB name must end with _test or _e2e.`,
  );
  process.exit(1);
}

// These must match e2e/tokens.ts in the web repo.
const tokenFor = (n: number) => `e2e-test-token-${String(n).padStart(8, "0")}`;
const EXPIRED = "e2e-test-token-expired-0001";
const USED = "e2e-test-token-used-000001";

const prisma = new PrismaClient();
const PAYFLOW = "tenant_payflow";
const ACME = "tenant_acme";

async function main() {
  await prisma.magicLink.deleteMany();
  await prisma.user.deleteMany();
  await prisma.auditEvent.deleteMany();

  const e2eUser = await prisma.user.create({
    data: { email: "e2e@payflow.test", name: "E2E User", tenantId: PAYFLOW },
  });
  await prisma.user.create({ data: { email: "other@acme.test", name: "Acme User", tenantId: ACME } });

  const now = Date.now();
  const services = ["payments", "auth", "orders", "billing", "gateway"];
  const actions = ["payment_completed", "user_login", "order_created", "invoice_created", "permission_denied"];

  // 120 generated events (20 ERROR, 20 WARN, 80 INFO) + the fixed demo event = 121, 21 of them ERROR.
  await prisma.auditEvent.createMany({
    data: [
      {
        id: "evt_9f81a2",
        tenantId: PAYFLOW,
        createdAt: new Date(now),
        level: Level.ERROR,
        service: "payments",
        actorId: "user_4821",
        action: "payment_failed",
        message: "Payment failed for customer during card authorization.",
        metadata: {
          paymentId: "pay_10492",
          amount: 1499,
          currency: "INR",
          provider: "stripe",
          reason: "card_declined",
        },
      },
      ...Array.from({ length: 120 }, (_, i) => ({
        id: `evt_e2e_${String(i).padStart(4, "0")}`,
        tenantId: PAYFLOW,
        createdAt: new Date(now - (i + 1) * 60_000),
        level: i % 6 === 0 ? Level.ERROR : i % 6 === 3 ? Level.WARN : Level.INFO,
        service: services[i % services.length]!,
        actorId: `user_${i % 5}`,
        action: actions[i % actions.length]!,
        message: `Seeded event number ${i}`,
        metadata: { i },
      })),
      {
        id: "evt_acme_secret",
        tenantId: ACME,
        createdAt: new Date(now),
        level: Level.INFO,
        service: "payments",
        actorId: "user_acme",
        action: "payment_completed",
        message: "tenant acme secret",
        metadata: {},
      },
    ],
  });

  const future = new Date(now + 24 * 60 * 60 * 1000);
  await prisma.magicLink.createMany({
    data: [
      ...Array.from({ length: 12 }, (_, i) => ({
        userId: e2eUser.id,
        tokenHash: hashToken(tokenFor(i + 1)),
        expiresAt: future,
      })),
      { userId: e2eUser.id, tokenHash: hashToken(EXPIRED), expiresAt: new Date(now - 60_000) },
      { userId: e2eUser.id, tokenHash: hashToken(USED), expiresAt: future, usedAt: new Date(now - 30_000) },
    ],
  });

  console.log("E2E seed complete: 122 events, 2 users, 14 magic-link tokens.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
