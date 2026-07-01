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

export { DocumentKindSchema, ParseStatusSchema, SearchModeSchema }
