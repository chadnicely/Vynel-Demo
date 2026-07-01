// `handleWorkspaceCreated` — outbox consumer for the
// `workspace.created` event. Starts the FileWatcherService for the
// new workspace + runs the initial `indexWorkspace` scan. Per
// blueprint §12 + §13.
//
// The outbox dispatcher itself is deferred (same state as memory +
// approvals consumers — written + exported, not yet polled from
// disk). When the cross-cutting dispatcher lands, the dispatch loop
// will route each `workspace.created` row to this function with the
// matching payload.
//
// SHAPE: `(db, deps, payload) => Promise<void>` — deps carries the
// singleton FileWatcherService instance (instantiated at api boot).
//
// `indexWorkspace` is invoked AFTER `startWatching` so the watcher
// is already armed when fresh files land mid-scan (the watcher's
// `ignoreInitial: true` means it won't re-fire on files
// `indexWorkspace` is currently reading, but it WILL catch anything
// arriving after the initial scan started).

import type { Database } from '@vynel/db'
import { FileWatcherService } from './file-watcher.js'
import { indexWorkspace, type IndexWorkspaceResult } from './index-workspace.js'
import type { StructuralLogger } from './knowledge-types.js'

export type HandleWorkspaceCreatedPayload = {
  workspaceId: string
  userId: string
  workspacePath: string
}

export async function handleWorkspaceCreated(
  db: Database,
  payload: HandleWorkspaceCreatedPayload,
  deps: { fileWatcher: FileWatcherService; logger?: StructuralLogger },
): Promise<IndexWorkspaceResult> {
  deps.fileWatcher.startWatching({
    workspaceId: payload.workspaceId,
    userId: payload.userId,
    workspacePath: payload.workspacePath,
  })
  const result = await indexWorkspace(db, payload, deps.logger ? { logger: deps.logger } : {})
  deps.logger?.info(
    {
      workspaceId: payload.workspaceId,
      indexed: result.indexedCount,
      skipped: result.skippedCount,
      failed: result.failedCount,
    },
    'handleWorkspaceCreated: initial scan complete',
  )
  return result
}
