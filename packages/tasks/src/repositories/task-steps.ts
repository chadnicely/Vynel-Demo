// Functional repository for the `task_steps` table. `db` is the first
// argument; Phase 1 SYNC returns. No raw SQL or Drizzle queries outside here.

import { and, asc, eq } from 'drizzle-orm'
import type { Database } from '@vynel/db'
import { taskSteps, type TaskStep, type NewTaskStep } from '../schema/task-steps.js'

export type { TaskStep, NewTaskStep, TaskStepStatus } from '../schema/task-steps.js'

export function listTaskSteps(
  db: Database,
  input: { userId: string; taskId: string },
): TaskStep[] {
  return db
    .select()
    .from(taskSteps)
    .where(and(eq(taskSteps.userId, input.userId), eq(taskSteps.taskId, input.taskId)))
    .orderBy(asc(taskSteps.orderIndex))
    .all()
}

export function findTaskStepById(db: Database, id: string): TaskStep | null {
  const [row] = db.select().from(taskSteps).where(eq(taskSteps.id, id)).limit(1).all()
  return row ?? null
}

export function insertTaskStep(db: Database, row: NewTaskStep): TaskStep {
  const [inserted] = db.insert(taskSteps).values(row).returning().all()
  if (!inserted) throw new Error('insertTaskStep: no row returned')
  return inserted
}

export function updateTaskStep(
  db: Database,
  id: string,
  patch: Partial<NewTaskStep>,
): TaskStep {
  const [updated] = db
    .update(taskSteps)
    .set(patch)
    .where(eq(taskSteps.id, id))
    .returning()
    .all()
  if (!updated) throw new Error(`updateTaskStep: no row for ${id}`)
  return updated
}

export function hardDeleteTaskStep(db: Database, id: string): void {
  db.delete(taskSteps).where(eq(taskSteps.id, id)).run()
}

/** Clear a task's whole list — the first half of the whole-list replace. */
export function hardDeleteTaskStepsForTask(
  db: Database,
  input: { userId: string; taskId: string },
): void {
  db.delete(taskSteps)
    .where(and(eq(taskSteps.userId, input.userId), eq(taskSteps.taskId, input.taskId)))
    .run()
}
