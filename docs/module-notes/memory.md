# memory — `@vynel/memory` (module notes)

Memory is knowledge-like (owns entries + FTS/vec via embeddings). Pulled faithfully in the 2026-07-03
fan-out (wave 1); now doing the **improve** phase one-by-one: (1) vertical-slice + fold, then (2) the tagging
+ sources feature build.

## ✅ BUILT (2026-07-11) — tags + `context` injection + file import

Step 2 landed (Chad's direct ask, matching the plan below):
- **`memory_tags` relation** (migration `0004_memory_tags`): open lowercase labels, ≤8/entry,
  unique per (entry, tag); `normalizeMemoryTags` in `memory-tags.ts` is the one gate.
  `DEFAULT_MEMORY_TAGS` are picker STARTERS, not an enum — the taxonomy grows in the wild.
- **`context` is the reserved BEHAVIORAL tag** (`CONTEXT_MEMORY_TAG`):
  `loadWorkspaceContextForSession` is now SELECTIVE — once any live entry wears `context`, those
  entries ALONE (freshest first, cap 50) form the session-start snapshot; with none, the old
  top-10-per-kind fallback keeps memory working pre-tags. `MEMORY_AGENT_INSTRUCTIONS` teaches the
  agent to SAVE standing facts tagged `context` and to UPDATE (not duplicate) them —
  `update_memory_entry` is now MCP-exposed (mutatingApproved) exactly for that.
- **Memory from a FILE**: `importMemoryEntryFromFile` — one-shot import (md/txt/pdf/docx/html/csv/
  json via `@vynel/indexer`), ≤20k chars (bigger → actionable error pointing at Knowledge),
  `createdSource: 'file-import'`, taggable. Route `POST /entries/from-file` + MCP
  `add_memory_from_file`. A WATCHED `memory_sources` registry stays the deliberate follow-up.
- **Routes**: `GET /tags` (in-use ∪ defaults, `context` first; MCP `list_memory_tags`) · create/
  update carry `tags` · entry responses carry `tags: string[]`.
- **`memory-maintenance-service`** (apps/local-api): embeddings tick 60 s + daily retention purge —
  these jobs were never registered ANYWHERE (worker or api), so memory semantic search had been
  silently FTS-only. Mirrors the knowledge-indexing-service pattern.

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
