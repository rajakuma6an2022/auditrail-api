import "dotenv/config";
import { PrismaClient } from "@prisma/client";

// Usage: npm run user:add -- you@example.com "Your Name" tenant_payflow
// Adds (or updates) a user WITHOUT touching any events.
const [emailArg, nameArg, tenantArg] = process.argv.slice(2);

if (!emailArg || !emailArg.includes("@")) {
  console.error('Usage: npm run user:add -- <email> ["Name"] [tenantId]');
  process.exit(1);
}

const prisma = new PrismaClient();
const email = emailArg.trim().toLowerCase();

prisma.user
  .upsert({
    where: { email },
    update: { name: nameArg ?? undefined, tenantId: tenantArg ?? undefined },
    create: { email, name: nameArg ?? "Support User", tenantId: tenantArg ?? "tenant_payflow" },
  })
  .then((u) => console.log(`OK: ${u.email} -> ${u.tenantId}`))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());