// `enqueueNoteDelivery` — the COMMUNICATION sibling of the two task enqueues
// (session-comms, the lateral kind): inserts a pending 'note' row that carries
// a plain message to a task-style target — a workspace primary or a
// spawned/agent session. Same durable FIFO queue, same claim keys (the target
// columns serialize a note behind whatever the target is already running), but
// it is never work: no report is expected, nothing tracks it, and the run
// views ignore it (`WORK_JOB_KINDS` keeps that mechanical).
//
// COLUMN REUSE (the delivery-row precedent, blessed over new columns):
//   `taskText`             — the marker-prefixed note body, composed by the
//                            dispatch (the sender's label + reply address are
//                            enqueue-time facts, so the marker rides the body
//                            like a direct answer's title does)
//   `workspaceName`        — the SENDER's composed label (the activity feed's
//                            persona line; the target's name resolves fresh at
//                            claim time)
//   `parentSessionId`      — the SENDER's SDK session ("from", provenance)
//   `requesterWorkspaceId` — the SENDER's workspace (null = a global sender):
//                            honest provenance, and the nodes screen's "from"
//                            end for free
//   target columns         — exactly like a task row (the row invariant holds)

import { randomUUID } from 'node:crypto'
import type { Database } from '@vynel/db'
import { resolveThreadId } from './resolve-thread-id.js'
import { insertDelegationJob } from '../repositories/index.js'
import type { DelegationPermissionMode } from '../orchestration-types.js'

export type NoteDeliveryTarget =
  | { kind: 'workspace'; workspaceId: string; workspacePath: string }
  | { kind: 'session'; targetPrimarySessionId: string; runCwdPath: string }
  // The GLOBAL conversation (voice-session arc): BOTH target columns null —
  // the same both-null shape a global-requester delivery row wears, so the
  // claim gate's global-key holdback and the delivery tick's global branch
  // pick it up; the notify runner resolves its own cwd.
  | { kind: 'global-root' }

export interface EnqueueNoteDeliveryInput {
  userId: string
  /** The SENDER's current SDK session — provenance, never resolved again. */
  senderSessionId: string
  /** The SENDER's composed display label ("Mark · Acme" / the session name). */
  senderLabel: string
  /** The SENDER's workspace — absent for a global-root sender. */
  senderWorkspaceId?: string
  target: NoteDeliveryTarget
  /** The marker-prefixed note body (the dispatch composes the marker). */
  noteBody: string
  /** The chain this note continues — a coordination note usually rides the
   *  task chain that caused it. Omit to start one. */
  threadId?: string
  /** The mode the note turn runs under — the sending turn's mode. */
  permissionMode?: DelegationPermissionMode
}

/** Enqueue a note as a pending job and return its id. */
export function enqueueNoteDelivery(
  db: Database,
  input: EnqueueNoteDeliveryInput,
  deps: { now?: () => Date } = {},
): string {
  if (input.target.kind === 'session' && input.target.targetPrimarySessionId.trim() === '') {
    // Exactly-one-target (the enqueueSessionDelegation guard): an empty session
    // target would produce a row with NO target at all — fail fast.
    throw new Error('enqueueNoteDelivery: targetPrimarySessionId must be a non-empty id')
  }
  const now = (deps.now ?? (() => new Date()))()
  const id = randomUUID()
  const partialSessionId = randomUUID()
  insertDelegationJob(db, {
    id,
    userId: input.userId,
    parentSessionId: input.senderSessionId,
    workspaceId: input.target.kind === 'workspace' ? input.target.workspaceId : null,
    workspacePath:
      input.target.kind === 'workspace'
        ? input.target.workspacePath
        : input.target.kind === 'session'
          ? input.target.runCwdPath
          : null,
    workspaceName: input.senderLabel,
    targetPrimarySessionId:
      input.target.kind === 'session' ? input.target.targetPrimarySessionId : null,
    taskText: input.noteBody,
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
    originChannelId: null,
    originExternalSenderId: null,
    originExternalChatContextId: null,
    permissionMode: input.permissionMode ?? null,
    model: null,
    thinkingEffort: null,
    jobKind: 'note',
    requesterWorkspaceId: input.senderWorkspaceId ?? null,
    createdAt: now,
  })
  return id
}
