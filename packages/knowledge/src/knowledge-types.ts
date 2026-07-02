// Domain-only types for the `knowledge` core layer. See
// `docs/blueprints/knowledge/coding.md §3` + blueprint §3.
//
// `StructuralLogger` is owned by `@vynel/logger` (type-only — pino's
// runtime never reaches the core layer). Row types are re-exported
// from `@vynel/db` for consumer convenience.

export type { StructuralLogger } from '@vynel/logger'

export type {
  KnowledgeDocumentRow,
  NewKnowledgeDocumentRow,
  KnowledgeChunkRow,
  NewKnowledgeChunkRow,
} from '@vynel/db/schema/knowledge'

export type { DocumentKind, ParseStatus } from '@vynel/db/schema/knowledge'

export type SkipReason = 'in-skipped-folder' | 'too-large' | 'unsupported-format'

export type SearchMode = 'fts' | 'semantic' | 'hybrid'

export type ListDocumentsCursor = {
  indexedAt: string | null
  id: string
}

export type ActivityEvent = {
  at: Date
  sourceId: string
  eventKind: 'added' | 'changed' | 'removed' | 'parse-failed'
  relativePath: string
  errorMessage?: string
}

export type IndexerStatus = {
  workspaceId: string
  totalDocuments: number
  parsedDocuments: number
  pendingDocuments: number
  parsingDocuments: number
  failedDocuments: number
  skippedDocuments: number
  unindexedChunks: number
  lastIndexedAt: Date | null
}

export type KnowledgeSearchResult = {
  chunkId: string
  documentId: string
  relativePath: string
  documentKind: import('@vynel/db/schema/knowledge').DocumentKind
  chunkIndex: number
  chunkText: string
  ftsScore: number | null
  semanticScore: number | null
  combinedScore: number
}
