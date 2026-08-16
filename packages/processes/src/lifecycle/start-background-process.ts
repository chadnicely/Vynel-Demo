// Core op — run a command in the background. sync insert + `process.started`
// co-commit in ONE transaction, then the spawn: durability-first, so a crash
// between the two leaves a `running` row the boot sweep settles honestly
// rather than a child nobody remembers.

import { randomUUID } from 'node:crypto'
import { withTransaction } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { ValidationError } from '@vynel/errors'
import * as processesRepository from '../repositories/index.js'
import { PROCESS_STARTED, type ProcessStartedPayload } from '../processes-events.js'
import { settleBackgroundProcess } from './settle-background-process.js'
import type { Database } from '@vynel/db'
import type { BackgroundProcess, BackgroundProcessOwnerKind } from '../repositories/index.js'
import type { StructuralLogger } from '../processes-types.js'
import type { BackgroundProcessRunner } from '../running/background-process-runner.js'

export const PROCESS_COMMAND_MAX_LENGTH = 4_000

// The runtime ceiling. Default generous enough for a full test suite or
// build; the max stops "run it for a week" becoming an unbounded background
// subscription (the monitor-TTL discipline, applied to OS processes).
export const PROCESS_DEFAULT_TIMEOUT_MS = 30 * 60 * 1000 // 30m
export const PROCESS_MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000 // 24h
const PROCESS_MIN_TIMEOUT_MS = 1_000 // 1s

// Fork-bomb guard: a session that wants an eleventh concurrent command is
// doing something the feature was not built for.
export const MAX_RUNNING_PROCESSES_PER_USER = 10

export interface StartBackgroundProcessInput {
  userId: string
  /** null = GLOBAL scope. Decides where the row lists, not where it runs —
   *  `cwdPath` is the resolved ground the ROUTE derived from the caller. */
  workspaceId: string | null
  ownerKind: BackgroundProcessOwnerKind
  /** Required for `spawned-session`, rejected otherwise (the monitors rule:
   *  a wake needs exactly one destination). */
  ownerSessionId?: string | null
  command: string
  cwdPath: string
  timeoutMs?: number
}

export function startBackgroundProcess(
  db: Database,
  input: StartBackgroundProcessInput,
  deps: { runner: BackgroundProcessRunner; logger?: StructuralLogger; now?: () => Date },
): BackgroundProcess {
  const command = input.command.trim()
  if (command.length === 0) {
    throw new ValidationError('A background process needs a command to run.')
  }
  if (command.length > PROCESS_COMMAND_MAX_LENGTH) {
    throw new ValidationError(
      `Background commands are capped at ${PROCESS_COMMAND_MAX_LENGTH} characters.`,
    )
  }

  const timeoutMs = input.timeoutMs ?? PROCESS_DEFAULT_TIMEOUT_MS
  if (timeoutMs < PROCESS_MIN_TIMEOUT_MS || timeoutMs > PROCESS_MAX_TIMEOUT_MS) {
    throw new ValidationError(
      `A background process must time out between 1 second and 24 hours (got ${timeoutMs}ms).`,
    )
  }

  const ownerSessionId = input.ownerSessionId ?? null
  if (input.ownerKind === 'spawned-session' && ownerSessionId === null) {
    throw new ValidationError('A spawned-session process must name its owning session.')
  }
  if (input.ownerKind !== 'spawned-session' && ownerSessionId !== null) {
    throw new ValidationError('Only a spawned-session process carries a session id.')
  }

  const running = processesRepository.countRunningBackgroundProcessesForUser(db, input.userId)
  if (running >= MAX_RUNNING_PROCESSES_PER_USER) {
    throw new ValidationError(
      `You already have ${running} background processes running (the cap is ` +
        `${MAX_RUNNING_PROCESSES_PER_USER}). Wait for one to finish or kill one first.`,
    )
  }

  const now = (deps.now ?? (() => new Date()))()
  const row = withTransaction(db, (tx) => {
    const inserted = processesRepository.insertBackgroundProcess(tx, {
      id: randomUUID(),
      userId: input.userId,
      workspaceId: input.workspaceId,
      ownerKind: input.ownerKind,
      ownerSessionId,
      command,
      cwdPath: input.cwdPath,
      status: 'running',
      pid: null,
      exitCode: null,
      failureReason: null,
      outputTail: null,
      timeoutMs,
      startedAt: now,
      finishedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    const payload: ProcessStartedPayload = {
      processId: inserted.id,
      userId: inserted.userId,
      workspaceId: inserted.workspaceId,
      ownerKind: inserted.ownerKind,
      command: inserted.command,
      cwdPath: inserted.cwdPath,
      // The spawn has not happened yet — the pid is stamped on the row after,
      // and the settle events carry the outcome; `started` is the intent.
      pid: null,
      timeoutMs,
      startedAt: now.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: PROCESS_STARTED,
      payload,
      createdAt: now,
      processedAt: null,
    })
    return inserted
  })

  // Spawn AFTER the commit. Spawn failures surface async through the runner's
  // settle path ('error' → onExit → the settle op fails the row); the sync
  // guard below covers only the exotic same-tick throw.
  try {
    const snapshot = deps.runner.start({
      processId: row.id,
      command,
      cwdPath: input.cwdPath,
      timeoutMs,
    })
    if (snapshot.pid !== null) {
      processesRepository.recordBackgroundProcessPid(db, {
        id: row.id,
        pid: snapshot.pid,
        updatedAt: now,
      })
    }
  } catch (err) {
    // Exotic (spawn defers its errors), but a committed `running` row with no
    // child and no armed monitor would otherwise sit until a restart — settle
    // it now, THEN surface the failure to the caller.
    deps.logger?.error({ processId: row.id, err }, 'background process spawn threw synchronously')
    settleBackgroundProcess(
      db,
      { processId: row.id, exitCode: null, failureReason: 'spawn-failed', outputTail: '' },
      { ...(deps.logger !== undefined ? { logger: deps.logger } : {}), now: () => now },
    )
    throw err
  }

  deps.logger?.info(
    { processId: row.id, command: command.slice(0, 120), timeoutMs },
    'background process started',
  )
  return processesRepository.findBackgroundProcessById(db, row.id) ?? row
}
