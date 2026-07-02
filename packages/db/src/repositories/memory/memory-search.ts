// Hybrid-search repository for the `memory` domain. Wraps the
// `memory_entries_fts` (FTS5) + `memory_entries_vec` (sqlite-vec)
// virtual tables. Dialect-aware — Phase 2 Postgres swaps to
// `tsvector` + `pgvector`. Same public signature across dialects.
// Spec: `docs/blueprints/memory/blueprint.md §4.3` + `decisions.md`
// D18.
//
// Phase 1 SYNC return values per phase-1-sync-transactions.
//
// FTS column indices used by `snippet()`:
//   0 = title, 1 = body  (the 2 indexed columns on `memory_entries_fts`).
// Blueprint §3.3 + §4.3 documented indices 2/3 + UNINDEXED entryId/workspaceId —
// pre-rule-era drift that predates chat's original FTS trigger fix. The post-fix
// pattern (external-content + 2 indexed cols only, JOIN back for the
// rest) is what ships. Reconcile docs at the post-ship doc pass.
//
// Reciprocal Rank Fusion uses k = 60 per Cormack et al. 2009 — do NOT
// tune away without an evaluation set.

import { sql } from 'drizzle-orm'
import type { Database } from '../../client.js'
import { activeDialect } from '../../dialect.js'

export type MemorySearchResult = {
  entryId: string
  // FTS snippet with literal `<mark>…</mark>` tokens — UI splits on the
  // literal tag, never `v-html` (chat Gate-3 XSS lock; coding-standard
  // "Frontend" + common-mistakes #18).
  matchedTitle: string
  matchedBody: string
  ftsScore: number | null
  semanticScore: number | null
  combinedScore: number
}

export type SearchMemoryEntriesInput = {
  workspaceId: string
  textQuery?: string
  embeddingQuery?: Buffer
  mode: 'fts' | 'semantic' | 'hybrid'
  limit?: number
}

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100
// Per-side ranking cap for hybrid mode — RRF needs enough candidates to
// fuse usefully. Anything past ~50 ranks contributes negligible weight
// at k=60.
const HYBRID_PER_SIDE_K = 50
// Reciprocal Rank Fusion constant — Cormack et al. 2009 default.
const RRF_K = 60

export function searchEntries(db: Database, input: SearchMemoryEntriesInput): MemorySearchResult[] {
  if (activeDialect === 'postgres') return searchEntriesPostgres(db, input)
  return searchEntriesSqlite(db, input)
}

function searchEntriesSqlite(db: Database, input: SearchMemoryEntriesInput): MemorySearchResult[] {
  switch (input.mode) {
    case 'fts':
      return searchFtsOnly(db, input)
    case 'semantic':
      return searchSemanticOnly(db, input)
    case 'hybrid':
      return searchHybrid(db, input)
  }
}

function searchEntriesPostgres(
  _db: Database,
  _input: SearchMemoryEntriesInput,
): MemorySearchResult[] {
  // Phase 2 — tsvector for text, pgvector for semantic. Implemented when
  // the Postgres migration baseline ships.
  throw new Error('Postgres memory search not implemented yet — Phase 2 only')
}

type FtsRow = {
  entryId: string
  matchedTitle: string
  matchedBody: string
  ftsScore: number
}

function searchFtsOnly(db: Database, input: SearchMemoryEntriesInput): MemorySearchResult[] {
  if (!input.textQuery) return []
  const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
  const rows = db.all<FtsRow>(sql`
    SELECT
      m.id AS entryId,
      snippet(memory_entries_fts, 0, '<mark>', '</mark>', '…', 16) AS matchedTitle,
      snippet(memory_entries_fts, 1, '<mark>', '</mark>', '…', 32) AS matchedBody,
      memory_entries_fts.rank AS ftsScore
    FROM memory_entries_fts
      JOIN memory_entries m ON m.rowid = memory_entries_fts.rowid
    WHERE memory_entries_fts MATCH ${input.textQuery}
      AND m.workspace_id = ${input.workspaceId}
      AND m.is_archived = 0
      AND m.deleted_at IS NULL
    ORDER BY memory_entries_fts.rank
    LIMIT ${limit}
  `)
  return rows.map((r) => ({
    entryId: r.entryId,
    matchedTitle: r.matchedTitle,
    matchedBody: r.matchedBody,
    ftsScore: r.ftsScore,
    semanticScore: null,
    // FTS5 rank is negative log-likelihood (less-negative = better).
    // Flip the sign so higher = better, consistent with semanticScore.
    combinedScore: -r.ftsScore,
  }))
}

type SemanticRow = {
  entryId: string
  matchedTitle: string
  matchedBody: string
  distance: number
}

function searchSemanticOnly(db: Database, input: SearchMemoryEntriesInput): MemorySearchResult[] {
  if (!input.embeddingQuery) return []
  const k = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
  const rows = db.all<SemanticRow>(sql`
    SELECT
      v.entryId AS entryId,
      m.title AS matchedTitle,
      substr(m.body, 1, 200) AS matchedBody,
      v.distance AS distance
    FROM memory_entries_vec v
      JOIN memory_entries m ON m.id = v.entryId
    WHERE v.workspaceId = ${input.workspaceId}
      AND v.embedding MATCH ${input.embeddingQuery}
      AND k = ${k}
      AND m.is_archived = 0
      AND m.deleted_at IS NULL
    ORDER BY v.distance
  `)
  return rows.map((r) => {
    // sqlite-vec returns L2 distance for float[] columns by default.
    // Map distance → bounded [0,1] score: 1 / (1 + d). Monotonic decreasing;
    // d=0 → score=1; d→∞ → score→0. Higher = better, consistent with FTS.
    const semanticScore = 1 / (1 + r.distance)
    return {
      entryId: r.entryId,
      matchedTitle: r.matchedTitle,
      matchedBody: r.matchedBody,
      ftsScore: null,
      semanticScore,
      combinedScore: semanticScore,
    }
  })
}

function searchHybrid(db: Database, input: SearchMemoryEntriesInput): MemorySearchResult[] {
  // Reciprocal Rank Fusion: combinedScore = sum over both sides of
  //   1 / (RRF_K + rank). Per Cormack, Clarke & Buettcher 2009.
  // Each side runs with a generous per-side cap (HYBRID_PER_SIDE_K) so
  // there are enough candidates to fuse; final list is sliced to input.limit.
  const perSideInput: SearchMemoryEntriesInput = {
    ...input,
    limit: HYBRID_PER_SIDE_K,
  }
  const ftsResults = input.textQuery ? searchFtsOnly(db, perSideInput) : []
  const semanticResults = input.embeddingQuery ? searchSemanticOnly(db, perSideInput) : []

  type FusionRow = MemorySearchResult & {
    ftsRank: number | null
    semanticRank: number | null
  }
  const byEntry = new Map<string, FusionRow>()

  ftsResults.forEach((r, idx) => {
    byEntry.set(r.entryId, {
      ...r,
      ftsRank: idx + 1,
      semanticRank: null,
    })
  })
  semanticResults.forEach((r, idx) => {
    const existing = byEntry.get(r.entryId)
    if (existing) {
      existing.semanticRank = idx + 1
      existing.semanticScore = r.semanticScore
      // Prefer the FTS snippet (carries `<mark>` tokens) when both
      // sides hit the entry; semantic-only has a generic body slice.
    } else {
      byEntry.set(r.entryId, {
        ...r,
        ftsRank: null,
        semanticRank: idx + 1,
      })
    }
  })

  const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
  return Array.from(byEntry.values())
    .map((r) => ({
      entryId: r.entryId,
      matchedTitle: r.matchedTitle,
      matchedBody: r.matchedBody,
      ftsScore: r.ftsScore,
      semanticScore: r.semanticScore,
      combinedScore:
        (r.ftsRank !== null ? 1 / (RRF_K + r.ftsRank) : 0) +
        (r.semanticRank !== null ? 1 / (RRF_K + r.semanticRank) : 0),
    }))
    .sort((a, b) => b.combinedScore - a.combinedScore)
    .slice(0, limit)
}

export function upsertVectorIndex(
  db: Database,
  entryId: string,
  workspaceId: string,
  embedding: Buffer,
): void {
  // sqlite-vec's vec0 virtual table does NOT support `ON CONFLICT DO
  // UPDATE` (fails at prepare time with `UPSERT not implemented for
  // virtual table`). The supported idempotent pattern is DELETE + INSERT.
  // Both statements are non-tx-aware (vec0 lives outside the SQL tx
  // model), but the caller wraps the surrounding embedding-store logic
  // in `withTransaction` for the memory_entries side; the vec0 side
  // converges by the time the tx commits.
  db.run(sql`DELETE FROM memory_entries_vec WHERE entryId = ${entryId}`)
  db.run(sql`
    INSERT INTO memory_entries_vec (entryId, workspaceId, embedding)
    VALUES (${entryId}, ${workspaceId}, ${embedding})
  `)
}

export function deleteVectorIndex(db: Database, entryId: string): void {
  // sqlite-vec does NOT honor SQL FK constraints or triggers — every
  // delete is explicit. Callers (deleteMemoryEntry, purge worker) MUST
  // call this whenever a row's vec representation is no longer valid.
  db.run(sql`DELETE FROM memory_entries_vec WHERE entryId = ${entryId}`)
}
