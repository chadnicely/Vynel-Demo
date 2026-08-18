// Read op — one task's steps in list order. Backs the task panel's expander
// and the `set_task_steps` tool's response (the write IS the read: the
// assistant sees exactly what the user's panel now shows).

import * as taskStepsRepository from '../repositories/task-steps.js'
import type { Database } from '@vynel/db'
import type { TaskStep } from '../repositories/task-steps.js'

export function listStepsForTask(
  db: Database,
  input: { userId: string; taskId: string },
): TaskStep[] {
  return taskStepsRepository.listTaskSteps(db, input)
}
