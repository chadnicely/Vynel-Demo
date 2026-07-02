// `handleWorkspaceRemoved` — outbox consumer for the `workspace.archived` and
// `workspace.hard-deleted` events. Stops the FileWatcherService for every source
// of the workspace. Document + chunk + source rows are removed elsewhere (the
// workspaces FK cascade on `workspace_id`). Per blueprint §12.
//
// Idempotent: `stopWatchingWorkspace(id)` is a no-op when no watcher is open for
// that workspace.

import { FileWatcherService } from '../indexing/file-watcher.js'
import type { StructuralLogger } from '../knowledge-types.js'

export type HandleWorkspaceRemovedPayload = {
  workspaceId: string
}

export async function handleWorkspaceRemoved(
  payload: HandleWorkspaceRemovedPayload,
  deps: { fileWatcher: FileWatcherService; logger?: StructuralLogger },
): Promise<void> {
  await deps.fileWatcher.stopWatchingWorkspace(payload.workspaceId)
  deps.logger?.info({ workspaceId: payload.workspaceId }, 'handleWorkspaceRemoved: watchers stopped')
}
