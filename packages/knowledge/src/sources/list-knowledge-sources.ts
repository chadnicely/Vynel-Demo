// `listKnowledgeSources` — the sources in scope for a workspace: the workspace's
// own registered directories PLUS the user's global sources. Thin wrapper over the
// repo; the shape the sources-list route + UI read.

import type { Database } from '@vynel/db'
import {
  listKnowledgeSourcesForWorkspace,
  type KnowledgeSourceRow,
} from '../repositories/index.js'

export function listKnowledgeSources(
  db: Database,
  input: { userId: string; workspaceId: string },
): KnowledgeSourceRow[] {
  return listKnowledgeSourcesForWorkspace(db, input)
}
