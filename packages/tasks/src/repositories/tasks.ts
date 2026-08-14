// Functional repository for the `tasks` table. `db` is the first argument;
// Phase 1 SYNC returns. No raw SQL or Drizzle queries outside this repo.

import { and, desc, eq, sql } from 'drizzle-orm'
import type { Database } from '@vynel/db'
import { tasks, type Task, type NewTask, type TaskStatus } from '../schema/tasks.js'

// Re-export row + union types so `@vynel/tasks` surfaces them via the
// package barrel (the schedules repo precedent).
export type { Task, NewTask, TaskStatus, TaskSource } from '../schema/tasks.js'

// A task list is small per scope, but cap defensively.
const DEFAULT_LIST_LIMIT = 100
const MAX_LIST_LIMIT = 200

export function listTasksForWorkspace(
  db: Database,
  input: {
    userId: string
    workspaceId: string
    status?: TaskStatus
    planId?: string
    limit?: number
  },
): Task[] {
  const limit = Math.min(input.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)
  const filters = [eq(tasks.userId, input.userId), eq(tasks.workspaceId, input.workspaceId)]
  if (input.status) filters.push(eq(tasks.status, input.status))
  if (input.planId) filters.push(eq(tasks.planId, input.planId))
  return db
    .select()
    .from(tasks)
    .where(and(...filters))
    .orderBy(desc(tasks.createdAt))
    .limit(limit)
    .all()
}

// All of a user's tasks across every workspace + the global (null-workspace)
// scope — the user-scoped `/tasks` surface (panel + dashboard). Filters by
// userId only (the tenant boundary); workspace scope is not narrowed.
export function listTasksForUser(
  db: Database,
  input: { userId: string; status?: TaskStatus; planId?: string; limit?: number },
): Task[] {
  const limit = Math.min(input.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)
  const filters = [eq(tasks.userId, input.userId)]
  if (input.status) filters.push(eq(tasks.status, input.status))
  if (input.planId) filters.push(eq(tasks.planId, input.planId))
  return db
    .select()
    .from(tasks)
    .where(and(...filters))
    .orderBy(desc(tasks.createdAt))
    .limit(limit)
    .all()
}

// Per-workspace done/total rollup (workspace redesign Arc 5b) — the tree
// rows' `4/13` progress and the rail's task-count lines, in one grouped
// read. The null-workspace (global) bucket rides along keyed null.
export type WorkspaceTaskCounts = {
  workspaceId: string | null
  total: number
  done: number
}

export function countTasksByWorkspace(db: Database, userId: string): WorkspaceTaskCounts[] {
  return db
    .select({
      workspaceId: tasks.workspaceId,
      total: sql<number>`count(*)`,
      done: sql<number>`sum(case when ${tasks.status} = 'done' then 1 else 0 end)`,
    })
    .from(tasks)
    .where(eq(tasks.userId, userId))
    .groupBy(tasks.workspaceId)
    .all()
}

export function findTaskById(db: Database, id: string): Task | null {
  const [row] = db.select().from(tasks).where(eq(tasks.id, id)).limit(1).all()
  return row ?? null
}

export function insertTask(db: Database, row: NewTask): Task {
  const [inserted] = db.insert(tasks).values(row).returning().all()
  if (!inserted) throw new Error('insertTask: no row returned')
  return inserted
}

export function updateTask(db: Database, id: string, patch: Partial<NewTask>): Task {
  const [updated] = db.update(tasks).set(patch).where(eq(tasks.id, id)).returning().all()
  if (!updated) throw new Error(`updateTask: no row for ${id}`)
  return updated
}

export function hardDeleteTask(db: Database, id: string): void {
  db.delete(tasks).where(eq(tasks.id, id)).run()
}
