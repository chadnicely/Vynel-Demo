// Hybrid-search repository for the `knowledge` domain. Wraps the
// `knowledge_chunks_fts` (FTS5) + `knowledge_chunks_vec` (sqlite-vec)
// virtual tables. Dialect-aware — Phase 2 Postgres swaps to
// `tsvector` + `pgvector`. Same public signature across dialects.
// Spec: `docs/blueprints/knowledge/blueprint.md §8.2`.
//
// Phase 1 SYNC return values per phase-1-sync-transactions.
//
// FTS column indices used by `snippet()`:
//   0 = chunk_id, 1 = workspace_id, 2 = document_id, 3 = chunk_text.
// Only chunk_text is indexed (the other 3 are UNINDEXED metadata);
// snippets are extracted from index 3.
//
// Reciprocal Rank Fusion uses k = 60 per Cormack et al. 2009 + the
// memory D4 precedent. Do NOT tune away without an evaluation set.
//
// documentKindFilter is applied per-side (joins knowledge_documents
// for the filter). SCOPE flows via `source_id`: callers pass the set of
// in-scope source ids (a workspace's sources + the user's global sources),
// resolved through the knowledge_documents join (FTS) / the vec row's
// source_id (semantic). Fuses workspace + global knowledge in one search.

import { sql } from 'drizzle-orm'
import type { Database } from '../../client.js'
import { activeDialect } from '../../dialect.js'
import type { DocumentKind } from '../../schema/knowledge/documents.js'

export type KnowledgeSearchResult = {
  chunkId: string
  documentId: string
  relativePath: string
  documentKind: DocumentKind
  chunkIndex: number
  chunkText: string
  ftsScore: number | null
  semanticScore: number | null
  combinedScore: number
}

export type SearchKnowledgeChunksInput = {
  // The in-scope source ids to search across (workspace's sources + the user's
  // global sources). Empty → no results.
  sourceIds: string[]
  textQuery?: string
  embeddingQuery?: Buffer
  mode: 'fts' | 'semantic' | 'hybrid'
  limit?: number
  documentKindFilter?: DocumentKind[]
}

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100
const HYBRID_PER_SIDE_K = 50
const RRF_K = 60

export function searchKnowledgeChunks(
  db: Database,
  input: SearchKnowledgeChunksInput,
): KnowledgeSearchResult[] {
  if (activeDialect === 'postgres') return searchKnowledgeChunksPostgres(db, input)
  return searchKnowledgeChunksSqlite(db, input)
}

function searchKnowledgeChunksSqlite(
  db: Database,
  input: SearchKnowledgeChunksInput,
): KnowledgeSearchResult[] {
  switch (input.mode) {
    case 'fts':
      return searchFtsOnly(db, input)
    case 'semantic':
      return searchSemanticOnly(db, input)
    case 'hybrid':
      return searchHybrid(db, input)
  }
}

function searchKnowledgeChunksPostgres(
  _db: Database,
  _input: SearchKnowledgeChunksInput,
): KnowledgeSearchResult[] {
  throw new Error('Postgres knowledge search not implemented yet — Phase 2 only')
}

type FtsRow = {
  chunkId: string
  documentId: string
  relativePath: string
  documentKind: DocumentKind
  chunkIndex: number
  chunkText: string
  ftsScore: number
}

// Quotes the user's query as a single FTS5 phrase. Doubles any
// embedded `"` so the surrounding quotes always close — prevents
// FTS5 syntax errors crashing the route on input like `foo()` or
// an unclosed double-quote. SQL parameter binding remains in place;
// this is DSL escaping, not SQL escaping.
function quoteFtsPhrase(rawQuery: string): string {
  return `"${rawQuery.replaceAll('"', '""')}"`
}

function searchFtsOnly(db: Database, input: SearchKnowledgeChunksInput): KnowledgeSearchResult[] {
  if (!input.textQuery || input.sourceIds.length === 0) return []
  const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
  const hasKindFilter = (input.documentKindFilter?.length ?? 0) > 0
  const kindFilterSql = hasKindFilter
    ? sql` AND d.document_kind IN (${sql.join(
        input.documentKindFilter!.map((k) => sql`${k}`),
        sql`, `,
      )})`
    : sql.empty()
  const ftsPhrase = quoteFtsPhrase(input.textQuery)
  const rows = db.all<FtsRow>(sql`
    SELECT
      c.id AS chunkId,
      c.document_id AS documentId,
      d.relative_path AS relativePath,
      d.document_kind AS documentKind,
      c.chunk_index AS chunkIndex,
      snippet(knowledge_chunks_fts, 0, '<mark>', '</mark>', '…', 32) AS chunkText,
      knowledge_chunks_fts.rank AS ftsScore
    FROM knowledge_chunks_fts
      JOIN knowledge_chunks c ON c.rowid = knowledge_chunks_fts.rowid
      JOIN knowledge_documents d ON d.id = c.document_id
    WHERE knowledge_chunks_fts MATCH ${ftsPhrase}
      AND d.source_id IN (${sql.join(
        input.sourceIds.map((sid) => sql`${sid}`),
        sql`, `,
      )})${kindFilterSql}
    ORDER BY knowledge_chunks_fts.rank
    LIMIT ${limit}
  `)
  return rows.map((r) => ({
    chunkId: r.chunkId,
    documentId: r.documentId,
    relativePath: r.relativePath,
    documentKind: r.documentKind,
    chunkIndex: r.chunkIndex,
    chunkText: r.chunkText,
    ftsScore: r.ftsScore,
    semanticScore: null,
    combinedScore: -r.ftsScore, // higher = better
  }))
}

type SemanticRow = {
  chunkId: string
  documentId: string
  relativePath: string
  documentKind: DocumentKind
  chunkIndex: number
  chunkText: string
  distance: number
}

function searchSemanticOnly(
  db: Database,
  input: SearchKnowledgeChunksInput,
): KnowledgeSearchResult[] {
  if (!input.embeddingQuery || input.sourceIds.length === 0) return []
  const k = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
  const hasKindFilter = (input.documentKindFilter?.length ?? 0) > 0
  const kindFilterSql = hasKindFilter
    ? sql` AND d.document_kind IN (${sql.join(
        input.documentKindFilter!.map((kind) => sql`${kind}`),
        sql`, `,
      )})`
    : sql.empty()
  // vec0's KNN pre-filter takes a single-equality metadata match, so query each
  // in-scope source's partition separately and merge — vec0 `IN (...)` is not a
  // reliable pre-filter. Each side returns its k nearest; keep the global top-k.
  const merged: SemanticRow[] = []
  for (const sourceId of input.sourceIds) {
    merged.push(
      ...db.all<SemanticRow>(sql`
        SELECT
          v.chunk_id AS chunkId,
          v.document_id AS documentId,
          d.relative_path AS relativePath,
          d.document_kind AS documentKind,
          c.chunk_index AS chunkIndex,
          substr(c.chunk_text, 1, 200) AS chunkText,
          v.distance AS distance
        FROM knowledge_chunks_vec v
          JOIN knowledge_chunks c ON c.id = v.chunk_id
          JOIN knowledge_documents d ON d.id = v.document_id
        WHERE v.source_id = ${sourceId}
          AND v.embedding MATCH ${input.embeddingQuery}
          AND k = ${k}${kindFilterSql}
        ORDER BY v.distance
      `),
    )
  }
  return merged
    .sort((a, b) => a.distance - b.distance)
    .slice(0, k)
    .map((r) => {
      const semanticScore = 1 / (1 + r.distance)
      return {
        chunkId: r.chunkId,
        documentId: r.documentId,
        relativePath: r.relativePath,
        documentKind: r.documentKind,
        chunkIndex: r.chunkIndex,
        chunkText: r.chunkText,
        ftsScore: null,
        semanticScore,
        combinedScore: semanticScore,
      }
    })
}

function searchHybrid(db: Database, input: SearchKnowledgeChunksInput): KnowledgeSearchResult[] {
  const perSideInput: SearchKnowledgeChunksInput = {
    ...input,
    limit: HYBRID_PER_SIDE_K,
  }
  const ftsResults = input.textQuery ? searchFtsOnly(db, perSideInput) : []
  const semanticResults = input.embeddingQuery ? searchSemanticOnly(db, perSideInput) : []

  type FusionRow = KnowledgeSearchResult & {
    ftsRank: number | null
    semanticRank: number | null
  }
  const byChunk = new Map<string, FusionRow>()

  ftsResults.forEach((r, idx) => {
    byChunk.set(r.chunkId, { ...r, ftsRank: idx + 1, semanticRank: null })
  })
  semanticResults.forEach((r, idx) => {
    const existing = byChunk.get(r.chunkId)
    if (existing) {
      existing.semanticRank = idx + 1
      existing.semanticScore = r.semanticScore
      // Prefer the FTS snippet (carries `<mark>` tokens) when both sides
      // hit; semantic-only has a generic substr slice.
    } else {
      byChunk.set(r.chunkId, { ...r, ftsRank: null, semanticRank: idx + 1 })
    }
  })

  const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
  return Array.from(byChunk.values())
    .map((r) => ({
      chunkId: r.chunkId,
      documentId: r.documentId,
      relativePath: r.relativePath,
      documentKind: r.documentKind,
      chunkIndex: r.chunkIndex,
      chunkText: r.chunkText,
      ftsScore: r.ftsScore,
      semanticScore: r.semanticScore,
      combinedScore:
        (r.ftsRank !== null ? 1 / (RRF_K + r.ftsRank) : 0) +
        (r.semanticRank !== null ? 1 / (RRF_K + r.semanticRank) : 0),
    }))
    .sort((a, b) => b.combinedScore - a.combinedScore)
    .slice(0, limit)
}

export function upsertVectorIndexForChunk(
  db: Database,
  input: {
    chunkId: string
    sourceId: string
    documentId: string
    embedding: Buffer
  },
): void {
  // sqlite-vec's vec0 doesn't support ON CONFLICT — the supported
  // idempotent pattern is DELETE + INSERT. Memory precedent.
  db.run(sql`DELETE FROM knowledge_chunks_vec WHERE chunk_id = ${input.chunkId}`)
  db.run(sql`
    INSERT INTO knowledge_chunks_vec (chunk_id, source_id, document_id, embedding)
    VALUES (${input.chunkId}, ${input.sourceId}, ${input.documentId}, ${input.embedding})
  `)
}

export function deleteVectorIndexForDocument(db: Database, documentId: string): void {
  // Purges all vec rows for a document — sqlite-vec doesn't honor FK
  // cascades. Called by removeFileFromIndex.
  db.run(sql`DELETE FROM knowledge_chunks_vec WHERE document_id = ${documentId}`)
}

export function deleteVectorIndexForSource(db: Database, sourceId: string): void {
  // Purges all vec rows for a source — sqlite-vec doesn't honor FK cascades, so
  // removing a source must purge its vec rows explicitly (deleting the source
  // cascades its documents + chunks relationally, but not the vec0 virtual table).
  db.run(sql`DELETE FROM knowledge_chunks_vec WHERE source_id = ${sourceId}`)
}
