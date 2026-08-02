// `listKnowledgeSources` — the sources in scope for a workspace: the workspace's
// own registered directories PLUS the user's global sources. Thin wrapper over the
// repo; the shape the sources-list route + UI read.

import type { Database } from '@vynel/db'
import {
  listKnowledgeSourcesForWorkspace,
  type KnowledgeSourceRow,
} from '../repositories/index.js'

// The boot-time read (watcher restore + catch-up scan) — every source, all
// users/scopes.
export { listAllKnowledgeSources } from '../repositories/index.js'

// The GLOBAL surface's read — only the user's global sources, no workspace
// anchor (the user-scoped route behind the global knowledge menu).
export { listGlobalKnowledgeSourcesForUser } from '../repositories/index.js'

// The per-source indexing rollup the sources-list route decorates rows with.
export { summarizeKnowledgeDocumentsBySource } from '../repositories/index.js'
export type { SourceDocumentSummary } from '../repositories/index.js'

export function listKnowledgeSources(
  db: Database,
  input: { userId: string; workspaceId: string },
): KnowledgeSourceRow[] {
  return listKnowledgeSourcesForWorkspace(db, input)
}
