# memory — `@vynel/memory` (module notes)

Memory is knowledge-like (owns entries + FTS/vec via embeddings). Pulled faithfully in the 2026-07-03
fan-out (wave 1); now doing the **improve** phase one-by-one: (1) vertical-slice + fold, then (2) the tagging
+ sources feature build.

## Chad's vision — the gaps to BUILD (schema changes, after the vertical-slice lands green)
> "We're gonna have tagging like `context` (carries context needed at session start) and one for normal
> memory (what Claude stores under its memory). Tags can be ~100 types — we need to find the categories. User
> can also add a memory directory or a single file for memory."

**Two layers of tags (my read + advice):**
- **Behavioral tags — a small FIXED enum (they change how memory acts):**
  - `context` → auto-injected into the **session-start** system prompt (this is what `session/load-workspace-
    context-for-session` + `session/build-memory-session-contribution` already do — the tag makes it
    *selective* rather than all-entries).
  - `recall` / `normal` → the Claude-memory-tool style: stored + pulled **on demand** during a turn, NOT
    auto-injected at start.
- **Topical tags — an OPEN, growing set (organize/retrieve; no behavior change):** the "~100 categories."
  **Advice: do NOT hard-code 100 upfront** — a fixed enum will be wrong + rigid. Seed ~15–20 starter
  categories (preferences · decisions · people · projects · glossary · credentials-refs · …) and let it grow.
  Finding the full taxonomy is a deliberate exercise AFTER the plumbing exists.
- **User memory sources (dir / single file):** knowledge's `add-directory`/sources pattern applied to memory —
  point memory at a path → ingest → embed → tag. Memory + knowledge converge on the sources shape; reuse the
  knowledge `sources` design (registry table, scope, watcher) as the template.

**Schema this implies (deliberate, planned — NOT slipped in on red):** a `memory_tags` relation (behavioral
enum + open topical text) on `memory_entries`; a `memory_sources` registry (mirror `knowledge_sources`).
Build AFTER step 1 lands green.

## Step 1 — ✅ DONE + green (vertical-slice + concern-fold, faithful, no schema change)
Landed: memory owns `schema/` + `repositories/` (moved from kernel); logic foldered into
`indexing`/`queries`/`lifecycle`/`session` (+ root `index`/`memory-types`/`memory-events`). **Proven pure
relocation:** `drizzle-kit generate` → "No schema changes", schema-parity 30 (unchanged), diff = 74 ins / 74
del (import-path only) + git renames, full gate **1019 green**. Only shared-surface touches: `drizzle.sqlite.
config.ts` (memory paths → cross-package) + kernel schema barrel (memory line dropped) + memory `package.json`
(+`drizzle-orm`). **This is the template for the other leaves' vertical-slice.**

### The move (as executed)
Mirror the knowledge shape. **Move from kernel → package** (pure relocation; drizzle fingerprint unchanged →
`drizzle-kit generate` must say "No schema changes"; parity stays green):
- `db/schema/memory/*` → `packages/memory/src/schema/`
- `db/repositories/memory/*` → `packages/memory/src/repositories/`
- rewire memory's logic imports `@vynel/db/schema|repositories/memory` → local; clean the kernel schema/repo
  barrels; add `../memory/src/schema/*` to `drizzle.config`. (Only memory + kernel import these — minimal.)

**Concern folders** (knowledge-style: schema · repositories · indexing · queries · lifecycle + a memory-
specific `session/`):
- `schema/` `repositories/` (moved)
- `indexing/` — `generate-memory-embeddings`, `embedding-worker-signal`
- `queries/` — `search-memory-for-agent`, `list-memory-entries-for-workspace`
- `lifecycle/` — `create`/`update`/`delete`/`record-memory-entry-mention`/`purge-soft-deleted`/
  `cleanup-…-hard-deleted`/`derive-title-from-body`
- `session/` — `load-workspace-context-for-session`, `build-memory-session-contribution` (memory's unique
  session-start contribution — the home the `context` tag will hook into)
- root: `memory-types`, `memory-events`, `index.ts`

Gate: typecheck + vitest (37 tests) + `drizzle-kit generate` "No schema changes" + full `pnpm test` (parity).
