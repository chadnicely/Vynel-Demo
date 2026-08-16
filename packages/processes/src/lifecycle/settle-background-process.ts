// Core op — a background process ended: flip the row terminal and speak the
// outbox event, in ONE transaction. Called from three places, all funnelled
// here so the outcome vocabulary can never drift: the runner's onExit binding
// (the normal path), the kill op's orphan branch, and the boot sweep.
//
// IDEMPOTENT BY CAS: the row update is guarded on `status = 'running'`
// (`settleBackgroundProcessRow`), so a settle racing a sweep across a restart
// resolves to one winner and ONE event — a double `process.completed` would
// double-wake every monitor watching it.

import { randomUUID } from 'node:crypto'
import { withTransaction } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import * as processesRepository from '../repositories/index.js'
import {
  PROCESS_COMPLETED,
  PROCESS_FAILED,
  PROCESS_EVENT_TAIL_MAX_CHARS,
  type ProcessCompletedPayload,
  type ProcessFailedPayload,
} from '../processes-events.js'
import type { Database } from '@vynel/db'
import type { BackgroundProcess } from '../repositories/index.js'
import type { ProcessFailureReason, StructuralLogger } from '../processes-types.js'

export interface SettleBackgroundProcessInput {
  processId: string
  exitCode: number | null
  /** Absent = the process exited on its own; the code decides the status. */
  failureReason?: ProcessFailureReason
  outputTail: string
}

export function settleBackgroundProcess(
  db: Database,
  input: SettleBackgroundProcessInput,
  deps: { logger?: StructuralLogger; now?: () => Date } = {},
): BackgroundProcess | null {
  const existing = processesRepository.findBackgroundProcessById(db, input.processId)
  if (existing === null) {
    deps.logger?.warn({ processId: input.processId }, 'settle for an unknown background process')
    return null
  }

  const failureReason = input.failureReason ?? null
  const succeeded = failureReason === null && input.exitCode === 0
  const now = (deps.now ?? (() => new Date()))()

  const settled = withTransaction(db, (tx) => {
    const updated = processesRepository.settleBackgroundProcessRow(tx, {
      id: input.processId,
      status: succeeded ? 'succeeded' : 'failed',
      exitCode: input.exitCode,
      failureReason,
      outputTail: input.outputTail,
      finishedAt: now,
    })
    // Already terminal — the CAS lost, someone else settled first. No event.
    if (updated === null) return null

    const durationMs = Math.max(0, now.getTime() - updated.startedAt.getTime())
    const outputTail =
      input.outputTail.length > PROCESS_EVENT_TAIL_MAX_CHARS
        ? input.outputTail.slice(-PROCESS_EVENT_TAIL_MAX_CHARS)
        : input.outputTail
    const shared = {
      processId: updated.id,
      userId: updated.userId,
      workspaceId: updated.workspaceId,
      ownerKind: updated.ownerKind,
      command: updated.command,
      durationMs,
      outputTail,
      finishedAt: now.toISOString(),
    }
    const payload: ProcessCompletedPayload | ProcessFailedPayload = succeeded
      ? { ...shared, exitCode: 0 }
      : { ...shared, exitCode: input.exitCode, failureReason }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: succeeded ? PROCESS_COMPLETED : PROCESS_FAILED,
      payload,
      createdAt: now,
      processedAt: null,
    })
    return updated
  })

  if (settled !== null) {
    deps.logger?.info(
      { processId: settled.id, status: settled.status, exitCode: input.exitCode, failureReason },
      'background process settled',
    )
  }
  return settled
}
