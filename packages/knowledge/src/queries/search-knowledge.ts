// `searchKnowledge` — async core op. Thin wrapper over the
// `searchKnowledgeChunks` repository function. Generates the query
// embedding via `@vynel/embeddings.generateEmbedding` OUTSIDE the
// search call when the mode is `semantic` or `hybrid`; FTS-only mode
// skips the model call entirely. Per blueprint §8.2 + D4 (hybrid RRF
// k=60 inherited from memory).
//
// Phase 1: the real MiniLM-L6-v2 implementation in `@vynel/embeddings`
// loads lazily on first call (per D23). Test files mock `@vynel/embeddings`
// with a deterministic FNV-1a + L2-normalized fake to avoid loading the
// model in CI.

import { generateEmbedding } from '@vynel/embeddings'
import { searchKnowledgeChunks } from '@vynel/db/repositories/knowledge'
import type { Database } from '@vynel/db'
import type { DocumentKind } from '@vynel/db/schema/knowledge'
import type { SearchMode } from '../knowledge-types.js'

export type SearchKnowledgeInput = {
  workspaceId: string
  query: string
  mode?: SearchMode
  limit?: number
  documentKindFilter?: DocumentKind[]
}

export type SearchKnowledgeResult = {
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

export async function searchKnowledge(
  db: Database,
  input: SearchKnowledgeInput,
): Promise<SearchKnowledgeResult[]> {
  const mode: SearchMode = input.mode ?? 'hybrid'
  const embeddingQuery =
    mode === 'semantic' || mode === 'hybrid' ? await generateEmbedding(input.query) : undefined

  return searchKnowledgeChunks(db, {
    workspaceId: input.workspaceId,
    ...(mode === 'semantic' ? {} : { textQuery: input.query }),
    ...(embeddingQuery !== undefined ? { embeddingQuery } : {}),
    mode,
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
    ...(input.documentKindFilter !== undefined
      ? { documentKindFilter: input.documentKindFilter }
      : {}),
  })
}
