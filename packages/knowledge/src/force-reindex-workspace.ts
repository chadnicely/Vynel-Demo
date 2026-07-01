// `forceReindexWorkspace` — flips every document in the workspace
// to `pending` then runs the standard `indexWorkspace` pass. Used
// by the "Reindex" POST route the user invokes from the Activity
// tab when a parser change ships or an embedding-model bump invalidates
// the existing index.
//
// The pending flip + the rescan are two separate steps; if the
// rescan throws mid-flight the workspace is left with some rows
// still pending. The next force-reindex picks up where this one
// stopped (idempotent).
//
// Per blueprint §8.4.

import type { Database } from '@vynel/db'
import { markAllKnowledgeDocumentsPendingForWorkspace } from '@vynel/db/repositories/knowledge'
import {
  indexWorkspace,
  type IndexWorkspaceInput,
  type IndexWorkspaceResult,
} from './index-workspace.js'
import type { StructuralLogger } from './knowledge-types.js'

export async function forceReindexWorkspace(
  db: Database,
  input: IndexWorkspaceInput,
  deps: { logger?: StructuralLogger } = {},
): Promise<IndexWorkspaceResult> {
  markAllKnowledgeDocumentsPendingForWorkspace(db, input.workspaceId)
  return indexWorkspace(db, input, deps)
}
