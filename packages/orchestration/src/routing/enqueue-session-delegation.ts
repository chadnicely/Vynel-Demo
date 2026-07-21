// `enqueueSessionDelegation` — the SESSION-target sibling of
// `enqueueWorkspaceDelegation` (session-library Slice ④): inserts a PENDING
// `delegation_jobs` row targeting a SPAWNED primary session instead of a
// workspace. Same durable FIFO queue, same claim/run/report machinery — the
// tick branches on `targetPrimarySessionId` to resume the spawned session's
// continuing SDK session rather than a workspace root.
//
// ROW INVARIANT (enforced here, by construction): exactly ONE of
// `workspaceId` / `targetPrimarySessionId` is set. This op writes the session
// target and nulls every workspace column except `workspacePath` — which holds
// the RUN CWD (the spawned session's SDK working dir; v1: the global root's
// hidden user-data dir). One column, one reading: "where this job's turn runs".

import { randomUUID } from 'node:crypto'
import type { Database } from '@vynel/db'
import { insertDelegationJob } from '../repositories/index.js'
import type { DelegationPermissionMode } from '../orchestration-types.js'
import type { DelegationOrigin } from './enqueue-workspace-delegation.js'

export interface EnqueueSessionDelegationInput {
  userId: string
  /** The enqueue-time global-root SDK session id — a LOOSE text ref, not a FK. */
  parentSessionId: string
  /** The spawned primary session the task targets (loose ref — the tick resolves it fresh). */
  targetPrimarySessionId: string
  /** The run cwd — the spawned session's SDK working dir (stored in `workspacePath`). */
  runCwdPath: string
  taskText: string
  /** Set when a CHANNEL message drove this delegation — the report is delivered back
   *  to this channel + recipient. Omit for a web/voice-text origin. */
  origin?: DelegationOrigin
  /** The permission mode the routed turn runs under — the delegating turn's mode.
   *  Omit for the default (`bypass-with-behavior-gate`). */
  permissionMode?: DelegationPermissionMode
}

/** Enqueue a spawned-session delegation as a pending job and return its id. */
export function enqueueSessionDelegation(
  db: Database,
  input: EnqueueSessionDelegationInput,
): string {
  // Exactly-one-target: an empty session target would produce a row with NO
  // target at all (workspaceId is null here by construction) — fail fast.
  if (input.targetPrimarySessionId.trim() === '') {
    throw new Error('enqueueSessionDelegation: targetPrimarySessionId must be a non-empty id')
  }
  const id = randomUUID()
  // The correlation key (same contract as the workspace enqueue): minted once per
  // request so the task, the session's reply, and the pushed report share one trace.
  const partialSessionId = randomUUID()
  insertDelegationJob(db, {
    id,
    userId: input.userId,
    parentSessionId: input.parentSessionId,
    workspaceId: null,
    workspacePath: input.runCwdPath,
    workspaceName: null,
    targetPrimarySessionId: input.targetPrimarySessionId,
    taskText: input.taskText,
    partialSessionId,
    status: 'pending',
    claimedAt: null,
    completedAt: null,
    resultText: null,
    errorMessage: null,
    surfacedToRootAt: null,
    originChannelId: input.origin?.channelId ?? null,
    originExternalSenderId: input.origin?.externalSenderId ?? null,
    originExternalChatContextId: input.origin?.externalChatContextId ?? null,
    permissionMode: input.permissionMode ?? null,
    createdAt: new Date(),
  })
  return id
}
