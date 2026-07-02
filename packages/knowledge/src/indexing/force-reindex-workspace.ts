// `forceReindexWorkspace` — flips every document in the workspace to `pending`,
// then re-scans each of the workspace's OWN sources (workspace-scoped; the user's
// global sources are shared and reindexed separately). Used by the "Reindex" POST
// route when a parser change ships or an embedding-model bump invalidates the index.
//
// The pending flip + the rescan are two separate steps; a mid-flight throw leaves
// some rows pending and the next run resumes (idempotent). Per blueprint §8.4.

import type { Database } from '@vynel/db'
import {
  markAllKnowledgeDocumentsPendingForWorkspace,
  listKnowledgeSourcesForWorkspace,
} from '@vynel/db/repositories/knowledge'
import { indexSource, type IndexSourceResult } from './index-workspace.js'
import type { StructuralLogger } from '../knowledge-types.js'

export type ForceReindexWorkspaceInput = {
  workspaceId: string
  userId: string
  workspacePath: string
}

export async function forceReindexWorkspace(
  db: Database,
  input: ForceReindexWorkspaceInput,
  deps: { logger?: StructuralLogger } = {},
): Promise<IndexSourceResult> {
  markAllKnowledgeDocumentsPendingForWorkspace(db, input.workspaceId)
  // Reindex the workspace's own sources (not the user's global ones).
  const sources = listKnowledgeSourcesForWorkspace(db, {
    userId: input.userId,
    workspaceId: input.workspaceId,
  }).filter((source) => source.workspaceId === input.workspaceId)

  const total: IndexSourceResult = { indexedCount: 0, skippedCount: 0, failedCount: 0 }
  for (const source of sources) {
    const result = await indexSource(db, source, deps)
    total.indexedCount += result.indexedCount
    total.skippedCount += result.skippedCount
    total.failedCount += result.failedCount
  }
  return total
}
