// Zod schemas for the `knowledge` HTTP routes — per `coding-standard.md`
// "Zod schemas": API-internal, suffix `Schema`, one consumer (apps/web
// is the first; promote to `@vynel/contracts/knowledge` on the second).
// See `docs/blueprints/knowledge/blueprint.md §9.1`.

import { z } from 'zod'

const DocumentKindSchema = z.enum([
  'markdown',
  'plain-text',
  'pdf',
  'docx',
  'html',
  'csv',
  'json',
  'unsupported',
])

const ParseStatusSchema = z.enum(['pending', 'parsing', 'parsed', 'failed', 'skipped'])

const SearchModeSchema = z.enum(['fts', 'semantic', 'hybrid'])

export const ListKnowledgeDocumentsQuerySchema = z.object({
  documentKind: DocumentKindSchema.optional(),
  cursorIndexedAt: z.string().datetime().nullable().optional(),
  cursorId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  // Exact workspace-relative path. When set, returns the 0/1 matching
  // document (other filters ignored) — used by the Files UI to read one
  // file's index status.
  path: z.string().min(1).max(4096).optional(),
})

export const SearchKnowledgeQuerySchema = z.object({
  query: z.string().min(1).max(500),
  mode: SearchModeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  // CSV of document kinds; the route splits it.
  documentKindFilter: z.string().optional(),
})

export const KnowledgeDocumentParamSchema = z.object({
  documentId: z.string().min(1),
})

// ── Response schemas ────────────────────────────────────────────────
// The serialized shapes each route returns. `serializers.ts` derives its
// return TYPES from these via `z.infer` (one source of truth per shape),
// and the routes wire them into `describeRoute` responses via `resolver`
// so the OpenAPI spec — and therefore the generated SDK return types —
// are real, not `unknown`.

export const KnowledgeDocumentSchema = z.object({
  id: z.string(),
  userId: z.string(),
  workspaceId: z.string(),
  relativePath: z.string(),
  documentKind: DocumentKindSchema,
  contentHash: z.string(),
  fileSizeBytes: z.number(),
  fileModifiedAt: z.string(),
  chunkCount: z.number(),
  parseStatus: ParseStatusSchema,
  parseErrorMessage: z.string().nullable(),
  indexedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const KnowledgeChunkSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  workspaceId: z.string(),
  chunkIndex: z.number(),
  startCharOffset: z.number(),
  endCharOffset: z.number(),
  chunkText: z.string(),
  chunkTokenEstimate: z.number(),
  embeddingPresent: z.boolean(),
  embeddingModelVersion: z.string().nullable(),
  createdAt: z.string(),
})

export const KnowledgeSearchResultSchema = z.object({
  chunkId: z.string(),
  documentId: z.string(),
  relativePath: z.string(),
  documentKind: DocumentKindSchema,
  chunkIndex: z.number(),
  chunkText: z.string(),
  ftsScore: z.number().nullable(),
  semanticScore: z.number().nullable(),
  combinedScore: z.number(),
})

export const IndexerStatusSchema = z.object({
  workspaceId: z.string(),
  totalDocuments: z.number(),
  parsedDocuments: z.number(),
  pendingDocuments: z.number(),
  parsingDocuments: z.number(),
  failedDocuments: z.number(),
  skippedDocuments: z.number(),
  unindexedChunks: z.number(),
  lastIndexedAt: z.string().nullable(),
})

const ListDocumentsCursorSchema = z.object({
  indexedAt: z.string().nullable(),
  id: z.string(),
})

// Envelope schemas — the exact top-level JSON each route emits.
export const ListKnowledgeDocumentsResponseSchema = z.object({
  documents: z.array(KnowledgeDocumentSchema),
  nextCursor: ListDocumentsCursorSchema.nullable(),
})

export const KnowledgeDocumentDetailResponseSchema = z.object({
  document: KnowledgeDocumentSchema,
  chunks: z.array(KnowledgeChunkSchema),
})

export const SearchKnowledgeResponseSchema = z.object({
  results: z.array(KnowledgeSearchResultSchema),
})

export const ReindexResponseSchema = z.object({
  indexedCount: z.number(),
  skippedCount: z.number(),
  failedCount: z.number(),
})

// ── Knowledge sources (registered directories or single files) ──────
const KnowledgeSourceScopeSchema = z.enum(['workspace', 'global'])
const KnowledgeSourceKindSchema = z.enum(['directory', 'file'])

export const AddDirectoryBodySchema = z.object({
  // A directory (indexed recursively) or a single file — the server resolves
  // which (path-safety) and stores it as the source's `sourceKind`.
  absolutePath: z.string().min(1).max(4096),
  scope: KnowledgeSourceScopeSchema,
})

export const KnowledgeSourceParamSchema = z.object({
  sourceId: z.string().min(1),
})

export const KnowledgeSourceSchema = z.object({
  id: z.string(),
  userId: z.string(),
  // Null for a global (user-level) source; set for a workspace source.
  workspaceId: z.string().nullable(),
  scope: KnowledgeSourceScopeSchema,
  sourceKind: KnowledgeSourceKindSchema,
  absolutePath: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

// The list row adds the indexing rollup — what lets the UI show "12 files
// indexed · 1 failed" instead of a silent row.
export const KnowledgeSourceListItemSchema = KnowledgeSourceSchema.extend({
  documentCount: z.number(),
  indexedDocumentCount: z.number(),
  failedDocumentCount: z.number(),
  lastIndexedAt: z.string().nullable(),
})

export const AddDirectoryResponseSchema = z.object({
  source: KnowledgeSourceSchema,
  indexed: z.object({
    indexedCount: z.number(),
    skippedCount: z.number(),
    failedCount: z.number(),
  }),
})

export const ListKnowledgeSourcesResponseSchema = z.object({
  sources: z.array(KnowledgeSourceListItemSchema),
})

export const RemoveKnowledgeSourceResponseSchema = z.object({
  removed: z.boolean(),
})

export { DocumentKindSchema, ParseStatusSchema, SearchModeSchema, KnowledgeSourceScopeSchema }
