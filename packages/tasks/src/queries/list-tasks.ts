// Read ops — the two list surfaces. Workspace-scoped backs the section + the
// in-session MCP `list_tasks`; user-scoped spans every workspace + the global
// (null-workspace) scope and backs the panel + the dashboard.

import * as tasksRepository from '../repositories/index.js'
import type { Database } from '@vynel/db'
import type { Task, TaskStatus } from '../repositories/index.js'

export function listTasks(
  db: Database,
  input: { userId: string; workspaceId: string; status?: TaskStatus },
): Task[] {
  return tasksRepository.listTasksForWorkspace(db, input)
}

export function listTasksForUser(
  db: Database,
  input: { userId: string; status?: TaskStatus },
): Task[] {
  return tasksRepository.listTasksForUser(db, input)
}
