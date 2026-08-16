// Read ops — what an agent can see of its background processes. One list per
// scope door (workspace / global — strict scope visibility, the monitors
// rule), one tenant-safe point read.

import * as processesRepository from '../repositories/index.js'
import type { Database } from '@vynel/db'
import type { BackgroundProcess, BackgroundProcessStatus } from '../repositories/index.js'

export function listBackgroundProcesses(
  db: Database,
  input: {
    userId: string
    /** null = the GLOBAL scope's processes (workspaceId IS NULL, never "all"). */
    workspaceId: string | null
    status?: BackgroundProcessStatus
    limit?: number
  },
): BackgroundProcess[] {
  const shared = {
    userId: input.userId,
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
  }
  return input.workspaceId === null
    ? processesRepository.listGlobalBackgroundProcessesForUser(db, shared)
    : processesRepository.listBackgroundProcessesForWorkspace(db, {
        ...shared,
        workspaceId: input.workspaceId,
      })
}

/** Null when the id is unknown OR owned by another user — the caller maps both
 *  to the same 404, so a probe can't tell "not yours" from "doesn't exist". */
export function getBackgroundProcess(
  db: Database,
  input: { userId: string; processId: string },
): BackgroundProcess | null {
  const row = processesRepository.findBackgroundProcessById(db, input.processId)
  if (row === null || row.userId !== input.userId) return null
  return row
}
