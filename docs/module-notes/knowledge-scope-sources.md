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
- **`knowledge_chunks`**: `+ source_id` (denorm; `ADD COLUMN` + backfill). No rebuild — the
  FTS external-content link is unaffected by adding a column.
- **`knowledge_chunks_fts`**: **NO CHANGE** — external-content FTS5 (chunk_text only); scope is
  filtered via the existing JOIN back to `knowledge_chunks`.
- **`knowledge_chunks_vec`**: **REBUILD** to `(chunk_id, source_id, document_id, embedding)` —
  straight copy from `knowledge_chunks` (embeddings preserved; no model recompute).

## Search (scope-fused)
Resolve in-scope sources: `SELECT id FROM knowledge_sources WHERE userId=? AND (workspaceId=? OR scope='global')`.
- **FTS**: existing query; change filter `c.workspace_id = ?` → `c.source_id IN (...)`.
- **Semantic**: per-source vec query (`v.source_id = ?`) merged in app (safe default; sidesteps
  vec0 `IN`/`OR` uncertainty) — or a single `IN` if verified supported. RRF k=60 unchanged.

## Migration (careful — real-data-tested)
1. create `knowledge_sources`.
2. `knowledge_documents` table-rebuild (0029 pattern): nullable `workspace_id` + `sourceId` + `scope` + new unique.
3. `knowledge_chunks` `ADD COLUMN source_id`.
4. `knowledge_chunks_vec` rebuild with `source_id`.
5. **BACKFILL**: per existing workspace create a `scope='workspace'` source (`absolutePath = workspace.path`);
   set `documents.sourceId` + `scope`; `chunks.source_id`; repopulate vec with `source_id`.

**NON-NEGOTIABLE TEST**: seed rows in the OLD shape → run migrate → assert every doc/chunk/embedding
survives and is searchable. (`migrate.ts` documents a prior rebuild that shipped green-but-broken
because only an empty DB was tested.)

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
