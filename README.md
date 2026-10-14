# Auditrail API

Express + Prisma + PostgreSQL (Neon) backend for **Auditrail**, a focused audit-log explorer: search, filter, find an event, inspect it.
Frontend: [auditrail-web](https://github.com/rajakuma6an2022/auditrail-web).

## What it does

- **Passwordless auth**: magic links are SHA-256 hashed before storage, expire after 15 minutes and are single-use (consumed with an atomic update), then exchanged for an httpOnly session cookie
- **Multi-tenant isolation**: `tenantId` always comes from the verified session, never from the request. Another tenant's event returns 404, so event IDs cannot be probed
- **Keyset (cursor) pagination** on `(tenantId, createdAt DESC, id DESC)`: no `OFFSET`, no `COUNT(*)`
- **Filters**: level, service, action, time range, and search over event id, actor and message
- **Hardening**: enumeration-safe login (always `202`), rate limiting, helmet, Zod validation on every input, parameterized queries (Prisma), request IDs and structured logs that never include query strings, so tokens cannot leak

## Architecture

Browser → Next.js on Vercel (proxies `/api/*`) → Express on Render → PostgreSQL on Neon.
The browser only talks to the Next.js origin, so the session cookie stays first-party.

### Endpoints

| Method | Path                      | Purpose                                                |
| ------ | ------------------------- | ------------------------------------------------------ |
| POST   | `/api/v1/auth/magic-link` | Request a sign-in link (always `202`)                  |
| POST   | `/api/v1/auth/verify`     | Exchange a link token for a session                    |
| GET    | `/api/v1/auth/me`         | Current user                                           |
| POST   | `/api/v1/auth/logout`     | Clear the session cookie                               |
| GET    | `/api/v1/events`          | Cursor-paginated, filtered list (tenant-scoped)        |
| GET    | `/api/v1/events/facets`   | Distinct services and actions for the filter dropdowns |
| GET    | `/api/v1/events/:id`      | One event (tenant-scoped, else 404)                    |
| GET    | `/health`, `/health/db`   | Liveness and database check                            |

## Measured results

Measured on a Neon branch seeded with **510,501 audit events** (510,001 in the main tenant, 56,120 of them `ERROR`),
about 791 bytes per row including indexes, 6 indexes in total. Times are PostgreSQL `EXPLAIN ANALYZE` execution times, not end-to-end latency.
They describe this dataset and environment, not a guarantee for other workloads.

**Filtered first page** (`level = ERROR`, newest first, `LIMIT 26`):

| Plan                                               | Execution time                   |
| -------------------------------------------------- | -------------------------------- |
| Composite index `(tenantId, level, createdAt, id)` | 0.510 ms and 0.529 ms (two runs) |
| No indexes (parallel sequential scan)              | 575.177 ms                       |

**Deep pagination** (position 50,000 into the result set; initial run, then 3 repeats):

| Method                               | Initial run | Repeats                   | Median    |
| ------------------------------------ | ----------- | ------------------------- | --------- |
| `OFFSET 50000`                       | 585.131 ms  | 47.908, 45.792, 42.402 ms | 45.792 ms |
| Keyset (cursor at the same position) | 0.113 ms    | 0.116, 0.141, 0.117 ms    | 0.117 ms  |

Keyset was about 391x faster by median (45.792 / 0.117). The first OFFSET run was cold, so the median of the repeats is the fairer comparison.

How to reproduce: seed with `npm run db:seed` / `SEED_APPEND=true`, then run `EXPLAIN (ANALYZE, BUFFERS)` for the first-page query
with and without the indexes (drop them inside a transaction and `ROLLBACK`), and for the keyset query use the `(createdAt, id)` of the row at offset 50,000 as the cursor.

## Tests

- `npm test`: **54 unit tests** (Vitest + Supertest, Prisma mocked)
- `npm run test:integration`: **12 tests against a real PostgreSQL**: keyset correctness across rows with identical timestamps, tenant isolation, and the magic-link flow including two simultaneous verifications of one token (exactly one succeeds). It refuses to run unless the database is local and named `*_test`
- GitHub Actions runs: `prisma validate`, format check, typecheck, unit tests, migrations, integration tests (Postgres service container) and the build

## Run locally

```bash
npm install
cp .env.example .env            # Neon URLs + JWT_SECRET
npm run db:migrate -- --name init
npm run db:seed                 # SEED_COUNT events (default 10,000)
npm run dev
```

`SEED_APPEND=true SEED_COUNT=90000 npm run db:seed` (grow the dataset without wiping),
`npm run db:size` (table and index size, bytes per row, projection against the storage limit).

Docker is not required: `docker-compose.yml` only provides a throwaway Postgres for the integration tests.

## Known trade-offs

- Logout clears the cookie but does not revoke the stateless 7-day JWT
- Search uses `ILIKE`: fine at this scale, but `pg_trgm` indexes (at a storage cost) would be the next step for much larger tables
- Hosted on free tiers: the first request after idle can take about a minute (Render cold start)
- Resend only delivers to verified recipients without a custom domain, so sign-in is limited to allow-listed addresses
