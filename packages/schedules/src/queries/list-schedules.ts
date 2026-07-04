// Core op — list the schedules for a workspace (owner-scoped, bounded). sync.
//
// Spec: `docs/blueprints/schedules/blueprint.md §5` + coding.md §5.

import * as schedulesRepository from '../repositories/index.js'
import type { Database } from '@vynel/db'
import type { Schedule } from '../repositories/index.js'

export function listSchedules(
  db: Database,
  input: { userId: string; workspaceId: string },
): Schedule[] {
  return schedulesRepository.listSchedulesForWorkspace(db, {
    userId: input.userId,
    workspaceId: input.workspaceId,
  })
}
