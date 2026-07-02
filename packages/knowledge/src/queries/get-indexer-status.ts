// `getIndexerStatus` — sync core op. Combines the documents
// status rollup with the chunks `unindexedChunks` count (the repo
// for `getStatusForWorkspace` reports 0 for that field by design —
// the chunks repo owns it).
//
// Per blueprint §8.4.

import type { Database } from '@vynel/db'
import {
  getKnowledgeIndexerStatusForWorkspace,
  countUnindexedKnowledgeChunksForWorkspace,
} from '../repositories/index.js'
import type { IndexerStatus } from '../knowledge-types.js'

export function getIndexerStatus(db: Database, workspaceId: string): IndexerStatus {
  const base = getKnowledgeIndexerStatusForWorkspace(db, workspaceId)
  const unindexedChunks = countUnindexedKnowledgeChunksForWorkspace(db, workspaceId)
  return {
    ...base,
    unindexedChunks,
  }
}
