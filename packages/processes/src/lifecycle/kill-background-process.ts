// Core op — end a running background process on request. Tenant-checked;
// unknown and not-owned answer the identical NotFoundError (no enumeration
// leak — the get_delegated_task precedent).
//
// FIRE-AND-FORGET for a live child: the runner delivers the kill and the
// settle path records the outcome exactly like a natural exit — the caller
// learns the result the same way every observer does. Only an ORPHAN (the row
// says running but the runner has no child — a restart race the sweep has not
// reached) settles synchronously here, because nobody else ever would.

import { NotFoundError, ValidationError } from '@vynel/errors'
import * as processesRepository from '../repositories/index.js'
import { settleBackgroundProcess } from './settle-background-process.js'
import type { Database } from '@vynel/db'
import type { BackgroundProcess } from '../repositories/index.js'
import type { StructuralLogger } from '../processes-types.js'
import type { BackgroundProcessRunner } from '../running/background-process-runner.js'

export function killBackgroundProcess(
  db: Database,
  input: { userId: string; processId: string },
  deps: { runner: BackgroundProcessRunner; logger?: StructuralLogger; now?: () => Date },
): BackgroundProcess {
  const row = processesRepository.findBackgroundProcessById(db, input.processId)
  if (row === null || row.userId !== input.userId) {
    throw new NotFoundError('background process', input.processId)
  }
  if (row.status !== 'running') {
    throw new ValidationError(
      `This process already finished (${row.status}) — nothing to kill.`,
    )
  }

  if (deps.runner.isRunning(row.id)) {
    deps.runner.kill(row.id, 'killed')
    deps.logger?.info({ processId: row.id }, 'background process kill requested')
    return row
  }

  // The orphan branch: row running, no live child — settle it here so the
  // row cannot stay running forever on a kill nobody can deliver.
  const settled = settleBackgroundProcess(
    db,
    { processId: row.id, exitCode: null, failureReason: 'killed', outputTail: '' },
    {
      ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
      ...(deps.now !== undefined ? { now: deps.now } : {}),
    },
  )
  return settled ?? row
}
