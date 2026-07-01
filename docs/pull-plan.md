# Vynel — First code pull (proposal)

**Created:** 2026-07-02 · **Status:** proposal for Chad's review — **nothing pulls until approved.**

## The goal

Prove the **pull-and-improve loop** on the **smallest self-contained, green vertical** before scaling
to the rest. Reuse the tested code; improve only *after* it's green. (Cadence: `.claude/rules/build-discipline.md`.)

## Why Knowledge first

- **Feature-complete + heavily tested** — 15 unit tests + a file-watcher integration test.
- **Self-contained** — it's index + search; it needs **no `providers` and no session layer** (those
  arrive with chat). So its vertical is small and provable in isolation.
- **Reuses `embeddings` + `indexer`** — already library-shaped, zero coupling.
- It's the pilot you named — and the cleanest proof of "lift → green → improve."

## The vertical (pull in order; each green before the next)

**Step 0 — Safeguard.** `git bundle` the old `refactor/foundation` branch → a backup file. Nothing
else touches KAFI.

**Step 1 — Kernel + shared** (the foundation everything imports):
`@vynel/db` (dialect · client · migrate · transactions · `_shared/outbox` · schema+repos for
`users` + `workspaces` + `knowledge`, incl. the SQL migrations for FTS5 + sqlite-vec) ·
`@vynel/errors` · `@vynel/logger` · `@vynel/config` · `@vynel/contracts` (knowledge slice) ·
`@vynel/testing`.
→ **Green:** db + repo tests + `withTestDatabase` pass.

**Step 2 — Stateless helpers:**
`@vynel/embeddings` (MiniLM wrapper + test fake) · `@vynel/indexer` (7 parsers + chunker).
→ **Green:** parser / chunker / embeddings tests pass.

**Step 3 — The feature:**
`@vynel/knowledge` (index-file · file-watcher · search · workspace hooks · embeddings worker ·
lifecycle events) + its 15 tests + the integration test.
**Improve as we pull:** rewire any `@vynel/core` re-export imports to direct package imports; tighten
the public `index.ts`.
→ **Green:** knowledge tests pass.

**Gate for this pull:** `turbo run typecheck` + `vitest run` green across the pulled packages.
(Full `pnpm test` parity — schema + MCP — activates once we pull `scripts/` + the api routes.)

## How we move the bytes

Recommended: `git archive` the specific package paths from the KAFI branch tip → extract into KLONE
(clean — no history, no `node_modules`), package-by-package; then `pnpm install` and adapt import
paths / `package.json` deps as needed. **Confirm this mechanism before I start.**

## After Knowledge

Small-by-small: `memory` (reuses `embeddings`; rehearses severing an outbox seam) → then `providers`
+ the chat/session spine (where the "everything is a session" library lands) → then surfaces (web,
desktop, CLI) + the net-new (memory backup/restore, marketplace backend).

## What I need from you

Approve **(a)** Knowledge-first, **(b)** the `git archive` move mechanism, **(c)** go on Step 0's
backup — then I start pulling, one step at a time, green before each next.
