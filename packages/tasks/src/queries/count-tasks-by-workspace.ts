// Per-workspace task rollup (workspace redesign Arc 5b) — done/total counts
// in one grouped read; the workspace-status surface joins them onto the
// user's workspaces (the tree's `4/13`, the rail's "N of M tasks done").

import * as tasksRepository from '../repositories/index.js'
import type { Database } from '@vynel/db'
import type { WorkspaceTaskCounts } from '../repositories/index.js'

export function countTasksByWorkspace(
  db: Database,
  input: { userId: string },
): WorkspaceTaskCounts[] {
  return tasksRepository.countTasksByWorkspace(db, input.userId)
}
