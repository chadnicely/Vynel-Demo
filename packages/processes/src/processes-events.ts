// Outbox event type constants + payload interfaces for the `processes` domain.
//
// Each event row is co-committed in the same sync `withTransaction(db, (tx) => …)`
// block as the state change via the `_shared/outbox` infra (architecture
// invariant: every state change co-commits its outbox event in ONE transaction).
//
// COMPLETED and FAILED are separate types on purpose: the monitor matcher's
// coarse gate is the TYPE list, so two types let a session watch failures
// alone ("wake me only if pnpm test breaks") without payload gymnastics. Every
// payload carries `userId` — the matcher's tenant gate fails closed without it
// (`match-monitor-to-event.ts` gate 1) and the event would be unwatchable.

import type { BackgroundProcessOwnerKind } from './schema/index.js'
import type { ProcessFailureReason } from './processes-types.js'

export const PROCESS_STARTED = 'process.started' as const
export const PROCESS_COMPLETED = 'process.completed' as const
export const PROCESS_FAILED = 'process.failed' as const

/** How much of the output tail rides IN the event payload — the monitor wake
 *  carries the payload, so this is what the woken session reads without a
 *  `get_background_process` round-trip. Bounded well under the persisted tail:
 *  outbox rows are read by every monitor pass. */
export const PROCESS_EVENT_TAIL_MAX_CHARS = 2000

export type ProcessStartedPayload = {
  processId: string
  userId: string
  workspaceId: string | null // null = GLOBAL scope
  ownerKind: BackgroundProcessOwnerKind
  command: string
  cwdPath: string
  pid: number | null
  timeoutMs: number
  startedAt: string
}

export type ProcessCompletedPayload = {
  processId: string
  userId: string
  workspaceId: string | null
  ownerKind: BackgroundProcessOwnerKind
  command: string
  exitCode: number
  durationMs: number
  /** The last stretch of output — enough to read a test summary off the wake. */
  outputTail: string
  finishedAt: string
}

export type ProcessFailedPayload = {
  processId: string
  userId: string
  workspaceId: string | null
  ownerKind: BackgroundProcessOwnerKind
  command: string
  exitCode: number | null
  /** Why it failed short of a clean exit — absent means a non-zero exit code. */
  failureReason: ProcessFailureReason | null
  durationMs: number
  outputTail: string
  finishedAt: string
}
