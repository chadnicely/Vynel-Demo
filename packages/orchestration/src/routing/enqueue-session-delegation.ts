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
import { resolveThreadId } from './resolve-thread-id.js'
import type { ThinkingEffortLevel } from '@vynel/contracts/chat/thinking-effort'
import { insertDelegationJob } from '../repositories/index.js'
import type { DelegationPermissionMode } from '../orchestration-types.js'
import type { DelegationOrigin } from './enqueue-workspace-delegation.js'

export interface EnqueueSessionDelegationInput {
  /** The chain this hop continues — one task and everything it caused. Omit to
   *  START a chain (the hop becomes its own thread). See `resolveThreadId`. */
  threadId?: string
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
  /** The root's model pick for the routed turn. Omit for the provider default. */
  model?: string
  /** The root's thinking-effort pick for the routed turn. Omit for the adaptive default. */
  thinkingEffort?: ThinkingEffortLevel
  /** WHO handed this task down — the calling workspace, so the target's report
   *  travels back to the conversation that asked instead of the session's own
   *  grounding. Omit for a GLOBAL-root send; note that omission does NOT force
   *  the report to the root — an omitted requester leaves a grounded session
   *  falling back to its grounding workspace (the routing layer's
   *  `resolveRequesterWorkspace`). The `enqueueWorkspaceDelegation` /
   *  `enqueueAgentRun` sibling field. */
  requesterWorkspaceId?: string
}

/** Enqueue a spawned-session delegation as a pending job and return its id. */
export function enqueueSessionDelegation(
  db: Database,
  input: EnqueueSessionDelegationInput,
  /** Injectable clock. Every row this op writes takes its createdAt from ONE
   *  read, and a test can stagger enqueues deterministically — the claim orders
   *  by (createdAt, id), so same-millisecond rows tie-break on a RANDOM uuid. */
  deps: { now?: () => Date } = {},
): string {
  // Exactly-one-target: an empty session target would produce a row with NO
  // target at all (workspaceId is null here by construction) — fail fast.
  if (input.targetPrimarySessionId.trim() === '') {
    throw new Error('enqueueSessionDelegation: targetPrimarySessionId must be a non-empty id')
  }
  const now = (deps.now ?? (() => new Date()))()
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
    threadId: resolveThreadId({
      ...(input.threadId !== undefined ? { inheritedThreadId: input.threadId } : {}),
      partialSessionId,
    }),
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
    model: input.model ?? null,
    thinkingEffort: input.thinkingEffort ?? null,
    requesterWorkspaceId: input.requesterWorkspaceId ?? null,
    createdAt: now,
  })
  return id
}
