// `searchMemoryForAgent` — async core op for hybrid memory search.
// The agent (via MCP tool `search_memory`) and the panel both call
// this. Hybrid is the default. The model call lives outside the
// search-repo invocation — `generateEmbedding` is async (model
// inference); `searchEntries` is sync (SQL).
//
// Mode behavior:
//   - 'fts': no embedding needed → textQuery alone
//   - 'semantic': embeddingQuery only → no textQuery
//   - 'hybrid': both → fused via RRF in the repo (k=60)

import { searchEntries, type MemorySearchResult } from '../repositories/index.js'
import { generateEmbedding } from '@vynel/embeddings'
import type { Database } from '@vynel/db'

export type SearchMemoryForAgentInput = {
  workspaceId: string
  query: string
  mode?: 'fts' | 'semantic' | 'hybrid'
  limit?: number
}

export async function searchMemoryForAgent(
  db: Database,
  input: SearchMemoryForAgentInput,
): Promise<MemorySearchResult[]> {
  const mode = input.mode ?? 'hybrid'

  // Only compute an embedding for the query when the search mode needs
  // one. FTS-only searches skip the model call entirely.
  const embeddingQuery =
    mode === 'semantic' || mode === 'hybrid' ? await generateEmbedding(input.query) : undefined

  // Conditional spread for optional `textQuery` per the
  // exactOptionalPropertyTypes precedent.
  const repoInput: Parameters<typeof searchEntries>[1] = {
    workspaceId: input.workspaceId,
    mode,
  }
  if (mode !== 'semantic') repoInput.textQuery = input.query
  if (embeddingQuery !== undefined) repoInput.embeddingQuery = embeddingQuery
  if (input.limit !== undefined) repoInput.limit = input.limit

  return searchEntries(db, repoInput)
}
