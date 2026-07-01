// The `knowledge_chunks` table for the `knowledge` domain — one row
// per chunk of an indexed file. Holds chunk text + character offsets
// + token estimate + embedding (Buffer; `bytes()` helper per D15 —
// adopted from memory D18; 384 floats × 4 bytes = 1536 bytes per row
// from `all-MiniLM-L6-v2`).
//
// Child table: NO `userId` column (EXEMPT per data-standard.md +
// D22 — tenant scope flows transitively via `documentId →
// knowledge_documents.userId`). `workspaceId` IS denormalized
// (without FK) for fast WHERE filtering in search queries — the
// transitive FK via documentId still holds.
//
// FTS5 + sqlite-vec virtual tables are created via SQL migrations,
// not as Drizzle schema files (per chat D17 + memory precedent).
//
// See `docs/blueprints/knowledge/blueprint.md §3.2` + `decisions.md`
// D15 + D22.

import { table, id, text, integer, timestamp, bytes, index } from '@vynel/db/dialect'
import { knowledgeDocuments } from './documents.js'

export const knowledgeChunks = table(
  'knowledge_chunks',
  {
    id: id().primaryKey(),
    // FK to knowledge_documents — cascade-on-delete makes chunks
    // disappear with their parent. The tenant scope (userId,
    // workspaceId) flows transitively through this FK.
    documentId: id()
      .notNull()
      .references(() => knowledgeDocuments.id, { onDelete: 'cascade' }),

    // Denormalized for fast WHERE filtering in search queries.
    // NO FK on this column (transitive via documentId); the denorm
    // exists solely to skip a join on every search. Per D22.
    workspaceId: id().notNull(),

    // 0-based order within the document; preserves chunk sequence
    // for "show me the next chunk after this match" UX.
    chunkIndex: integer().notNull(),

    // Offsets into the parsed text; the UI highlights which slice
    // of the document matched a search hit.
    startCharOffset: integer().notNull(),
    endCharOffset: integer().notNull(),

    // The actual chunk content — used for FTS5 (via trigger) and
    // embedded by the worker.
    chunkText: text().notNull(),

    // Rough token estimate; used for cap-budgeting when stuffing
    // chunks into context. Approximated as `characterCount / 4`.
    chunkTokenEstimate: integer().notNull(),

    // Generated asynchronously by the embedding worker (§13.1).
    // Null until generated. 384 × float32 = 1536 bytes per row
    // (MiniLM-L6-v2 via @vynel/embeddings — per D15 + D23).
    embedding: bytes(),
    embeddingModelVersion: text(),

    createdAt: timestamp().notNull(),
  },
  (t) => ({
    byDocumentIdx: index('idx_knowledge_chunks_document').on(t.documentId, t.chunkIndex),
    byWorkspaceIdx: index('idx_knowledge_chunks_workspace').on(t.workspaceId),
  }),
)

export type KnowledgeChunkRow = typeof knowledgeChunks.$inferSelect
export type NewKnowledgeChunkRow = typeof knowledgeChunks.$inferInsert
