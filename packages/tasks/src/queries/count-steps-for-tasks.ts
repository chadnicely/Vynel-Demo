// Read op — per-task step rollups for a set of tasks. Backs the `n/m` step
// progress the list routes attach to each task row so the panel can show
// progress without expanding.

import * as taskStepsRepository from '../repositories/task-steps.js'
import type { Database } from '@vynel/db'
import type { TaskStepCounts } from '../repositories/task-steps.js'

export function countStepsForTasks(
  db: Database,
  input: { userId: string; taskIds: readonly string[] },
): TaskStepCounts[] {
  return taskStepsRepository.countTaskStepsForTasks(db, input)
}
