// `registerKnowledgeSource` — the "add a directory or file to my knowledge"
// core op. Validates the path (path-safety, which also resolves whether it's a
// directory or a single file), inserts the source at the chosen scope
// (workspace or global), starts the file watcher on it, and runs the initial
// scan. The add-source HTTP route + the `add_to_knowledge` MCP tool call this.

import { randomUUID } from 'node:crypto'
import type { Database } from '@vynel/db'
import {
  insertKnowledgeSource,
  findKnowledgeSourceById,
  type KnowledgeSourceRow,
  type KnowledgeSourceScope,
} from '../repositories/index.js'
import { indexSource, type IndexSourceResult } from '../indexing/index-workspace.js'
import { FileWatcherService } from '../indexing/file-watcher.js'
import { resolveIndexableSourceKind } from './path-safety.js'
import type { StructuralLogger } from '../knowledge-types.js'

export type RegisterKnowledgeSourceInput = {
  userId: string
  // Null for a global (user-level) source; set for a workspace source.
  workspaceId: string | null
  scope: KnowledgeSourceScope
  absolutePath: string
}

export type RegisterKnowledgeSourceResult = {
  source: KnowledgeSourceRow
  indexed: IndexSourceResult
}

export async function registerKnowledgeSource(
  db: Database,
  input: RegisterKnowledgeSourceInput,
  deps: { fileWatcher: FileWatcherService; logger?: StructuralLogger },
): Promise<RegisterKnowledgeSourceResult> {
  const sourceKind = resolveIndexableSourceKind(input.absolutePath)

  const now = new Date()
  const id = randomUUID()
  insertKnowledgeSource(db, {
    id,
    userId: input.userId,
    workspaceId: input.workspaceId,
    scope: input.scope,
    absolutePath: input.absolutePath,
    sourceKind,
    createdAt: now,
    updatedAt: now,
  })
  const source = findKnowledgeSourceById(db, id)
  if (!source) throw new Error('registerKnowledgeSource: source vanished after insert')

  deps.fileWatcher.startWatchingSource(source)
  const indexed = await indexSource(db, source, deps.logger ? { logger: deps.logger } : {})
  return { source, indexed }
}
