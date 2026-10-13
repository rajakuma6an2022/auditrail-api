# Auditrail API

Express + Prisma + PostgreSQL (Neon) backend for **Auditrail**, a focused event-investigation / audit-log explorer
(Search → Filter → Find event → Inspect). Frontend: [auditrail-web](https://github.com/rajakuma6an2022/auditrail-web).

## What it does

- **Passwordless auth**: magic links (SHA-256 hashed, 15-minute, single-use, atomically consumed) → httpOnly session cookie
- **Multi-tenant isolation**: `tenantId` always comes from the verified session, never from the request; another tenant's event is a 404
- **Keyset pagination** on `(tenantId, createdAt DESC, id DESC)`: no `OFFSET`, no `COUNT(*)`. The first-page query was verified as an Index Scan with `EXPLAIN ANALYZE` (0.47 ms at 10,000 rows)
- Filters: level, service, action, time range (presets and custom), search over event id / actor / message
- Enumeration-safe login (always `202`), rate limiting, helmet, Zod validation, request IDs and structured logs (query strings are never logged, so tokens cannot leak)

## Architecture

Browser → Next.js on Vercel (proxies `/api/*`) → Express on Render → PostgreSQL on Neon.
The browser only talks to the Next.js origin, so the session cookie stays first-party.

## Tests

- `npm test`: 54 unit tests (Vitest + Supertest, Prisma mocked)
- `npm run test:integration`: 12 tests against a real PostgreSQL: keyset correctness across rows with identical timestamps, tenant isolation, and the magic-link flow including two simultaneous verifies of one token (exactly one succeeds). Refuses to run unless the database is local and named `*_test`.
- GitHub Actions runs format check, typecheck, unit tests, migrations, integration tests and build against a Postgres service container.

## Run locally

```bash
npm install
cp .env.example .env            # Neon URLs + JWT_SECRET
npm run db:migrate -- --name init
npm run db:seed                 # 10,000 events by default (SEED_COUNT)
npm run dev
```

## Growing the dataset

`SEED_APPEND=true SEED_COUNT=90000 npm run db:seed` adds events without wiping. `npm run db:size` reports table and index
size, bytes per row and a projection against the plan's storage limit (`STORAGE_LIMIT_MB`, default 1024 for Neon Free).
Measure at 100k+ rows before choosing a larger target.

## Known trade-offs

- Logout clears the cookie but does not revoke the stateless 7-day JWT
- Search uses `ILIKE`: fast at this scale, would need `pg_trgm` indexes (at a storage cost) for much larger tables
- Free-tier hosting: the first request after idle can take about a minute (Render cold start)
