# Postgres (Phase 2) — reference notes from letterman

Distilled from a read of `E:/GROWTH HACKING V2/letterman/packages/db` (a Postgres + Drizzle stack).
Captured for when Vynel's Phase-2 Postgres branch lands. **Not actionable now** (Phase 1 is SQLite).

## Headline
Letterman is a strong reference for **Postgres plumbing** (driver, pooled/direct split, boot migrator,
testcontainers, env validation) and gives us **nothing on our two hardest Phase-2 problems**: pgvector and
tsvector/FTS are both **explicitly deferred** there (btree-only search; zero `vector`/`tsvector`/`GIN`/`hnsw`
DDL). → Plan our FTS5→tsvector and sqlite-vec→pgvector migration from **Postgres docs**, not this repo.

Letterman uses plain **postgres.js** TCP pooling in a long-lived process — no Neon/serverless HTTP driver, no
cold-start handling. That fits Vynel-desktop; only revisit if Phase 2 ever goes edge/serverless.

## Adopt when Phase 2 lands (ranked)
1. **Pooled/direct client split, two env URLs** — `DATABASE_URL` (pooled) + `DIRECT_DATABASE_URL` (direct,
   `max: 1`). drizzle-kit **and** the migrator use the *direct* URL. WHY: on a hosted transaction-mode pooler
   (Neon `:6543`/Supabase/PgBouncer), DDL + prepared statements misbehave through the pooler — migrations must
   bypass it. The single most important structural item. *Only if Phase-2 PG is hosted/pooled; moot if local.*
2. **`prepare: false` on the pooled client if the pooler is transaction-mode.** postgres.js prepares by
   default; under a transaction pooler that silently breaks. Letterman *omits* this (latent bug) — treat as the
   cautionary tale, set it explicitly. [S]
3. **`closeDb()` graceful shutdown** for the boot migrator + CLI. An unclosed postgres.js pool keeps the event
   loop alive and hangs `&&` chains / CI. Vynel's boot migrator + a future db-direct CLI need exactly this. [S]
4. **Monotonic migration-order guard.** Drizzle's postgres-js migrator compares a single last-applied
   timestamp, so an out-of-order migration is silently unappliable on a non-fresh DB while reporting success
   (a fresh testcontainer masks it). Vynel hand-authors SQL → adopt the *principle*: assert the migration
   sequence is total + monotonic, cheaply tested. [S]
5. **Hand-prepend extension DDL at the top of `0000`.** `CREATE EXTENSION IF NOT EXISTS <x>` (idempotent) since
   drizzle-kit doesn't manage extensions. Vynel already hand-authors the FTS/vec DDL the same way — pgvector
   needs `CREATE EXTENSION vector` at the top of the PG baseline. [S]
6. **testcontainers** (`postgres:16-alpine`) as the PG test substrate — the Phase-2 analogue of
   `withTestDatabase`'s SQLite temp file. Detail: `Wait.forLogMessage('…ready to accept connections', 2)` (the
   2nd occurrence; initdb logs it once before the real server). But see Avoid. [M]
7. **`citext` for case-insensitive unique email** — a **dialect-seam** candidate (SQLite equiv: `COLLATE
   NOCASE` / `lower(email)` unique index). Keep single-consumer custom types local to their table; promote to
   `_shared/` only on a 2nd consumer. [S]
8. **Zod env validators as a shared package**, composed per-app (`urlSchema`/`secretSchema` export types, never
   values). Vynel already mandates this — confirmation, not new. [S]

## Dialect-seam checklist (what `packages/db/src/dialect.ts` must translate for PG)
Letterman has **no** dialect abstraction (Postgres-only) — our seam is strictly more capable. Its value is as a
checklist of PG-native constructs to translate: `citext` → NOCASE / `lower()` index · `pgEnum` → text + CHECK ·
`uuid().defaultRandom()` / `gen_random_uuid()` → app-side id · `timestamp({withTimezone:true})` (timestamptz,
used everywhere) → our dialect `timestamp` · `jsonb` → text/json.

## Avoid / doesn't fit
- **No vector or FTS reference** — deferred there; get zero help for the tsvector/pgvector migration.
- **No RLS** — isolation is app-level `user_id` FK + cascade. This *matches* our one-DB modular-monolith +
  "every row carries userId"; don't read letterman as an argument for RLS.
- **Fresh container + full migration replay per test** is slow — for Phase-2 tests prefer a **shared container
  with per-test schema or transaction rollback**, not container-per-file.
- **No retries / `connect_timeout` / pool health** — adequate for a long-lived server, not a resilience template.
- **`process.env.X!` at module load inside the db package** — sidesteps the `env.ts` boundary. Vynel's rule (no
  `process.env` outside each app's `env.ts`; pass the validated URL into the client) is stricter and better —
  keep ours.
