// `handleWorkspaceCreated` — outbox consumer for the `workspace.created` event.
// Ensures the workspace folder is registered as a `'workspace'` knowledge source,
// starts the FileWatcherService on it, and runs the initial scan. Auto-registering
// the workspace folder replaces the old "auto-index the workspace folder only"
// behavior (the user adds more sources — workspace or global — via the routes).
// Per blueprint §12 + §13.
//
// The outbox dispatcher itself is deferred (same state as memory + approvals
// consumers — written + exported, not yet polled from disk). When the dispatcher
// lands, the loop routes each `workspace.created` row to this function.
//
// `indexSource` runs AFTER `startWatchingSource` so the watcher is armed when
// fresh files land mid-scan (`ignoreInitial: true` means it won't re-fire on files
// the scan is currently reading, but WILL catch anything arriving after).

import { randomUUID } from 'node:crypto'
import type { Database } from '@vynel/db'
import {
  findWorkspaceSourceByPath,
  findKnowledgeSourceById,
  insertKnowledgeSource,
  type KnowledgeSourceRow,
} from '@vynel/db/repositories/knowledge'
import { FileWatcherService } from '../indexing/file-watcher.js'
import { indexSource, type IndexSourceResult } from '../indexing/index-workspace.js'
import type { StructuralLogger } from '../knowledge-types.js'

export type HandleWorkspaceCreatedPayload = {
  workspaceId: string
  userId: string
  workspacePath: string
}

export async function handleWorkspaceCreated(
  db: Database,
  payload: HandleWorkspaceCreatedPayload,
  deps: { fileWatcher: FileWatcherService; logger?: StructuralLogger },
): Promise<IndexSourceResult> {
  const source = ensureWorkspaceSource(db, payload)
  deps.fileWatcher.startWatchingSource(source)
  const result = await indexSource(db, source, deps.logger ? { logger: deps.logger } : {})
  deps.logger?.info(
    {
      workspaceId: payload.workspaceId,
      sourceId: source.id,
      indexed: result.indexedCount,
      skipped: result.skippedCount,
      failed: result.failedCount,
    },
    'handleWorkspaceCreated: initial scan complete',
  )
  return result
}

// Idempotent: return the existing workspace source for this folder, or create it.
function ensureWorkspaceSource(
  db: Database,
  payload: HandleWorkspaceCreatedPayload,
): KnowledgeSourceRow {
  const existing = findWorkspaceSourceByPath(db, {
    workspaceId: payload.workspaceId,
    absolutePath: payload.workspacePath,
  })
  if (existing) return existing
  const now = new Date()
  const id = randomUUID()
  insertKnowledgeSource(db, {
    id,
    userId: payload.userId,
    workspaceId: payload.workspaceId,
    scope: 'workspace',
    absolutePath: payload.workspacePath,
    createdAt: now,
    updatedAt: now,
  })
  const row = findKnowledgeSourceById(db, id)
  if (!row) throw new Error('handleWorkspaceCreated: source vanished after insert')
  return row
}
