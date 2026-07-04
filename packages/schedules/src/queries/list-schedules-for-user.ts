// Core op — list ALL the schedules a user owns, across every workspace + the
// global (null-workspace) scope. The user-scoped `/schedules` surface's list.
// Mirrors `listSchedules` (workspace-scoped) but gathers the whole set. sync.
//
// Spec: `docs/blueprints/schedules/blueprint.md §5` + coding.md §5.

import * as schedulesRepository from '../repositories/index.js'
import type { Database } from '@vynel/db'
import type { Schedule } from '../repositories/index.js'

export function listSchedulesForUser(db: Database, input: { userId: string }): Schedule[] {
  return schedulesRepository.listSchedulesForUser(db, { userId: input.userId })
}
