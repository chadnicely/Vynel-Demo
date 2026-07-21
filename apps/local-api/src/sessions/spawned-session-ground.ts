// The run cwd of a SPAWNED session's turn — ONE home for every producer that
// runs (or enqueues) a turn inside a spawned session's ground: the
// `send_task_to_session` enqueue route and the interactive session-turn stream
// (sessions-surface Slice ③a). A workspace-grounded session runs in its
// workspace's folder; a global-grounded one in the root's hidden user-data
// dir. A DELETED grounding workspace falls back to the global dir (graceful,
// the tick's name-fallback precedent) rather than stranding the session.

import type { Database } from '@vynel/db'
import type { PrimarySessionRow } from '@vynel/session/continuity'
import { findWorkspaceById } from '@vynel/workspaces'
import { ensureGlobalRootWorkspaceDir } from './global-root-workspace.js'

export function resolveSpawnedSessionRunCwd(
  db: Database,
  spawned: Pick<PrimarySessionRow, 'workspaceId'>,
): string {
  const workspace =
    spawned.workspaceId !== null ? findWorkspaceById(db, spawned.workspaceId) : null
  return workspace?.path ?? ensureGlobalRootWorkspaceDir()
}
