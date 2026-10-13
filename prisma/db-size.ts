import "dotenv/config";
import { PrismaClient } from "@prisma/client";

// Measures real storage per row, then projects larger seed sizes against the plan limit.
// Run it after seeding (ideally at 100k+ rows: tiny tables are dominated by fixed overhead).
const LIMIT_MB = Number(process.env.STORAGE_LIMIT_MB ?? 1024); // Neon Free: 1 GB per project
const HEADROOM = 0.8; // keep 20% free for WAL/other tables/migrations
const prisma = new PrismaClient();
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

async function main() {
  const [t] = await prisma.$queryRaw<
    Array<{ rows: bigint; total: bigint; heap: bigint; indexes: bigint; db: bigint }>
  >`SELECT (SELECT count(*) FROM "AuditEvent")::bigint AS rows,
            pg_total_relation_size('"AuditEvent"')::bigint AS total,
            pg_relation_size('"AuditEvent"')::bigint AS heap,
            pg_indexes_size('"AuditEvent"')::bigint AS indexes,
            pg_database_size(current_database())::bigint AS db`;
  const rows = Number(t!.rows);
  const total = Number(t!.total);
  if (rows === 0) {
    console.log("AuditEvent is empty: seed first.");
    return;
  }

  console.log(`\nRows:            ${rows.toLocaleString()}`);
  console.log(`Table (heap):    ${mb(Number(t!.heap))}`);
  console.log(`Indexes:         ${mb(Number(t!.indexes))}`);
  console.log(`Table + indexes: ${mb(total)}`);
  console.log(`Whole database:  ${mb(Number(t!.db))}   (limit ${LIMIT_MB} MB)`);
  console.log(`Per row:         ${Math.round(total / rows)} bytes (heap + all indexes)`);

  const idx = await prisma.$queryRaw<Array<{ name: string; size: bigint }>>`
    SELECT indexrelname AS name, pg_relation_size(indexrelid)::bigint AS size
    FROM pg_stat_user_indexes WHERE relname = 'AuditEvent' ORDER BY size DESC`;
  console.log("\nIndex sizes:");
  for (const i of idx) console.log(`  ${i.name.padEnd(50)} ${mb(Number(i.size))}`);

  const perRow = total / rows;
  const otherBytes = Number(t!.db) - total; // users, magic links, system catalogs
  console.log(`\nProjection (limit ${LIMIT_MB} MB, safe up to ${Math.round(LIMIT_MB * HEADROOM)} MB):`);
  for (const target of [100_000, 500_000, 1_000_000, 2_000_000]) {
    const projected = perRow * target + otherBytes;
    const ok = projected / 1024 / 1024 <= LIMIT_MB * HEADROOM;
    console.log(
      `  ${target.toLocaleString().padStart(9)} rows -> ${mb(projected).padStart(10)}  ${ok ? "fits" : "TOO BIG"}`,
    );
  }
  if (rows < 50_000) console.log("\nNote: under 50k rows the per-row number is unreliable. Measure again at 100k+.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
