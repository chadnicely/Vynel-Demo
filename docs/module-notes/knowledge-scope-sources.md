# Knowledge — scope + sources (design lock)

**Status: PROPOSED** — pending Chad's confirm on (1) global scope and (2) this approach.
Builds on `knowledge.md` (the gap notes). Grounded in the old repo's clean docs
(`E:\KAFI\WORKSPACE\v2\vynel\.claude\docs\knowledge\`).

## Goal
Knowledge addable at **workspace** OR **global** scope by the user registering directories.
`add-to-knowledge` is an MCP tool (mutating → cards). Search at a workspace fuses **that
workspace's sources + the user's global sources**.

## Model — everything hangs off a *source*
- **NEW `knowledge_sources`**: `id`, `userId` (FK cascade), `scope` `'workspace'|'global'`,
  `workspaceId` (nullable FK; set iff workspace), `absolutePath`, `createdAt`, `updatedAt`.
  Partial-unique (0029 precedent): `UNIQUE(workspaceId, absolutePath) WHERE scope='workspace'`
  + `UNIQUE(userId, absolutePath) WHERE scope='global'`.
- **`knowledge_documents`**: `+ sourceId` (FK→sources), `+ scope` (denorm); `workspaceId` →
  **nullable**; `relativePath` now relative to the source dir; unique flips
  `(workspaceId, relativePath)` → `(sourceId, relativePath)`. [table-rebuild, 0029 pattern]
- **`knowledge_chunks`**: **REBUILD** (FK-off, PRESERVE rowid) — drop the now-dead `workspace_id`,
  add `source_id` (NOT NULL). WHY rebuild: `workspace_id` is `NOT NULL` with no FK (pure denorm);
  global chunks have no workspace, so it must go — and SQLite can't drop a column's NOT-NULL without
  a rebuild. Rowid is preserved (explicit `INSERT ... (rowid, ...) SELECT rowid, ...`) so the
  external-content FTS index stays valid.
- **`knowledge_chunks_fts`**: index data UNCHANGED (rowids preserved), but its 3 triggers drop with
  the old chunks table → **recreate the 3 triggers** verbatim from 0012. No FTS reindex needed.
- **`knowledge_chunks_vec`**: **REBUILD** to `(chunk_id, source_id, document_id, embedding)` —
  repopulate from `knowledge_chunks` (embeddings copied from the stored blob; no recompute).

## Search (scope-fused)
Resolve in-scope sources: `SELECT id FROM knowledge_sources WHERE userId=? AND (workspaceId=? OR scope='global')`.
- **FTS**: existing query; change filter `c.workspace_id = ?` → `c.source_id IN (...)`.
- **Semantic**: per-source vec query (`v.source_id = ?`) merged in app (safe default; sidesteps
  vec0 `IN`/`OR` uncertainty) — or a single `IN` if verified supported. RRF k=60 unchanged.

## Migration `0038_...` (hand-written .sql + `_journal.json` entry, idx 38; FK-off is handled by `runMigrations` at connection level, 0029 pattern)
1. **CREATE `knowledge_sources`** + indexes + the 2 partial-unique indexes.
2. **BACKFILL sources**: one `scope='workspace'` source per distinct `(user_id, workspace_id)` present
   in `knowledge_documents`; **deterministic id `'kbsrc_' || workspace_id`** (so docs/chunks join to it
   without random ids); `absolute_path = workspaces.path`.
3. **`knowledge_documents` rebuild** (0029 pattern): `workspace_id` → nullable, `+ source_id` (NOT NULL),
   `+ scope` (NOT NULL DEFAULT 'workspace'); `INSERT..SELECT` sets `source_id='kbsrc_'||workspace_id`,
   `scope='workspace'`; drop+rename; recreate indexes incl. **unique `(source_id, relative_path)`**.
4. **`knowledge_chunks` rebuild** (PRESERVE rowid): drop `workspace_id`, `+ source_id` (NOT NULL);
   `INSERT..(rowid,...) SELECT rowid,...,'kbsrc_'||workspace_id,...`; drop+rename; recreate indexes
   (`byDocument`, `bySource`).
5. **Recreate the 3 FTS triggers** on `knowledge_chunks` (verbatim from 0012). FTS index data is
   untouched (rowids preserved) — no reindex.
6. **`knowledge_chunks_vec` rebuild**: drop; create with `source_id`; `INSERT..SELECT id, source_id,
   document_id, embedding FROM knowledge_chunks WHERE embedding IS NOT NULL`.

**NON-NEGOTIABLE TEST** (`0038_*.test.ts` in `packages/db`): build a temp DB, apply the REAL migrations
`0000..0037` (old shape), **seed** ≥1 workspace + docs + chunks + embeddings + FTS + vec rows, apply
`0038`, then assert: sources created; every doc + chunk survived with correct `source_id`/`scope`;
`workspace_id` now nullable; embeddings intact; **FTS search still returns**; **vec search still
returns**. (`migrate.ts` documents a prior rebuild that shipped green-but-broken because only an empty
DB was tested — this test closes that gap.)

## Core / routes / mcp / cli
- **Core**: register/list/remove source; generalize `index-workspace` → `index-source`; watcher
  watches registered sources (auto-register the workspace folder on `workspace.created` — replaces
  auto-index); scope-fused search; scope-aware list/status.
- **Routes**: `POST` add-source (add-directory) mutating, `x-mcp` `add_to_knowledge`; GET/DELETE
  sources; scope params on search/list. Regenerate SDK + MCP registry (parity green).
- **CLI**: `knowledge add-directory` / `sources`.
- **Agent-turn binding** of `add_to_knowledge` (③) + the approval **card** are
  providers/approvals-gated → follow-up (per sequence: knowledge → workspace pkg → providers).

## Path-safety (D4)
Reuse skip rules (`.vynel`/`Archive`/`node_modules`/dotfiles/>50 MB/unsupported) + reject
nonexistent/unreadable + no symlink escape (`followSymlinks:false`) + refuse system/home roots.

## Open confirms
- **D1**: global scope **IN** (reverses the `2026-06-20` "knowledge per-workspace only", still
  encoded in the capabilities schema).
- **Approach**: source-partition + vec-only rebuild (above).
- Defaults (flip if wanted): **D2** disk = arbitrary absolute dirs · **D3** registry replaces
  auto-index · **D5** single fused RRF.
