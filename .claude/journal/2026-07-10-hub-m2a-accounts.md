# 2026-07-10 — Hub M2a: the cloud second system (cloud-db · accounts · cloud-api)

**The move.** Same day as D1, Chad said "go" on the hub. Built milestone 2a of cloud-api.md §8:
`packages/cloud-db` (Postgres kernel, PGlite test substrate), `packages/accounts` (email+password
auth: argon2id, EdDSA JWT, family-based refresh rotation with reuse detection, set-password links,
platform-shaped provisioning), `apps/cloud-api` (thin Hono; /auth + /admin + /health). Gate
2063/4-skip; reviewer found no must-fix and four security should-fixes, all applied.

## Learnings worth keeping

- **PGlite is the right Postgres test substrate for this repo.** Real pg dialect, in-process,
  in-memory, no Docker on the gate — `withTestCloudDatabase` mirrors `withTestDatabase` exactly,
  and drizzle's pglite driver + migrator run the same committed migrations production uses.
  `CloudDatabase = PgDatabase<PgQueryResultHKT>` is the supertype both drivers satisfy.
- **A throw inside `db.transaction` rolls back everything — including your punishment.** First cut
  of the rotation fix killed the token family inside the tx then threw: the rollback would have
  un-killed it. Claim inside the tx, return a verdict, punish (family kill) + throw OUTSIDE.
- **Claim-based single-use enforcement beats read-then-write.** `UPDATE ... WHERE revoked_at IS
  NULL RETURNING` (rows=0 → concurrent consumption) turns TOCTOU races on refresh rotation and
  single-use links into detectable signals — the reviewer's top finding, one shape fixes both.
- **Anti-enumeration is a ROUTE property, not just a flow property.** The leaf was careful
  (generic error, timing dummy) but the route still leaked: awaiting link issuance made known
  emails answer slower (fix: fire-and-forget + immediate 202), and the disabled-403 fired before
  password proof (fix: status check only after the password matches).
- **Never `clear()` a rate-limit map under pressure** — an attacker who can grow the map resets
  every live window. Sweep expired entries only (tested with a 10k junk-key flood).
- **@node-rs/argon2's `Algorithm` is an ambient const enum** — unusable under
  verbatimModuleSyntax; spell the member numerically with a WHY comment (`2 as Algorithm`).
- **The parity guard generalized cleanly:** every `packages/*/src/schema` file must be claimed by
  exactly ONE drizzle config — the second system slots into the existing gate instead of dodging it.
- **zod's `.email()` requires a 2+ char TLD** — `ghost@x.y` is a 400, not a valid test email.

## Deferred (deliberate, reviewer-noted)

`kid` header on the access JWT before any client pins the public key (M3) · revoked refresh-row
retention sweep · move pglite out of prod deps before the Docker image · expired-token +
tampered-bearer test cases · extract the duplicated `buildCapturingMail` on a third use ·
server.ts boot live-verified only at deploy (needs real Postgres).
