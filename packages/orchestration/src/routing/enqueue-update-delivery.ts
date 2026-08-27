// `enqueueUpdateDelivery` — inserts (or coalesces into) a PENDING
// `delegation_jobs` row of kind 'update-delivery' (persona-sessions arc): a
// child's spoken ACK/progress travels UP by running a notify turn on the
// REQUESTER's conversation, exactly like a report — except an update is
// ephemeral status, not a result. Three deliberate differences from
// `enqueueReportDelivery`:
//
//   1. COALESCING — at most ONE pending update per (user, requester target,
//      thread). A newer update replaces the pending body in place, KEEPING the
//      row's queue position (createdAt) and trace key: the child said something
//      newer before the queue got to the old one, so the old one is obsolete.
//      A CLAIMED update is already being spoken — a new row is enqueued behind
//      it. This bounds ack-storm traffic without touching the claim's FIFO.
//   2. It never participates in `reportedAt` semantics (dispatch-side rule).
//   3. A terminally failed update is dropped, never pushed as a give-up report
//      (the tick's rule) — the final report remains the only guaranteed copy.
//
// ROW INVARIANT: identical to report-delivery — requester `workspaceId` set =
// that workspace's primary, BOTH targets null = the global root,
// `targetPrimarySessionId` set = the VOICE thread (voice-requester routing;
// leaves still never receive updates). Column reuse identical: `taskText` =
// the update body, `workspaceName` = the child's composed label,
// `parentSessionId` = the reporter's sdk session id.

import { randomUUID } from 'node:crypto'
import type { Database } from '@vynel/db'
import { resolveThreadId } from './resolve-thread-id.js'
import {
  findPendingUpdateDelivery,
  insertDelegationJob,
  replacePendingDelegationJobBody,
} from '../repositories/index.js'
import type { ReportDeliveryRequester } from './enqueue-report-delivery.js'

export interface EnqueueUpdateDeliveryInput {
  /** The chain this update belongs to. Omit to let the hop become its own
   *  thread (see `resolveThreadId`) — coalescing then keys on that hop alone. */
  threadId?: string
  userId: string
  /** The REPORTER's (child's) current sdk session id — provenance. */
  reporterSessionId: string
  /** The child's composed display label ("Mark · Acme" / the session name). */
  reporterLabel: string
  /** The update body — the notify turn's inbound message. */
  updateBody: string
  requester: ReportDeliveryRequester
}

/** Enqueue (or coalesce) an update-delivery job for the requester; returns the
 *  id of the row that will carry the update. */
export function enqueueUpdateDelivery(
  db: Database,
  input: EnqueueUpdateDeliveryInput,
  deps: { now?: () => Date } = {},
): string {
  if (input.updateBody.trim() === '') {
    throw new Error('enqueueUpdateDelivery: updateBody must be non-empty')
  }
  if (input.reporterSessionId.trim() === '') {
    throw new Error('enqueueUpdateDelivery: reporterSessionId must be a non-empty id')
  }
  const now = (deps.now ?? (() => new Date()))()
  const requester = input.requester
  const requesterWorkspaceId = requester.kind === 'workspace-primary' ? requester.workspaceId : null
  // The VOICE requester's address (voice-requester routing) — also the coalesce
  // key's second half: a voice update and a global update share a null
  // workspaceId, and only this column tells their pending rows apart.
  const requesterPrimarySessionId = requester.kind === 'voice' ? requester.voicePrimarySessionId : null

  // A fresh correlation key per delivery hop (the report-delivery shape) —
  // resolved BEFORE the coalesce check because the thread key derives from it
  // when no thread is inherited.
  const partialSessionId = randomUUID()
  const threadId = resolveThreadId({
    ...(input.threadId !== undefined ? { inheritedThreadId: input.threadId } : {}),
    partialSessionId,
  })

  // Coalesce: replace the body of the still-pending update for this
  // (user, target, thread). The CAS inside guards the claim race — if the row
  // got claimed between find and replace, fall through to a fresh insert.
  const pending = findPendingUpdateDelivery(db, {
    userId: input.userId,
    requesterWorkspaceId,
    requesterPrimarySessionId,
    threadId,
  })
  if (pending !== null) {
    const replaced = replacePendingDelegationJobBody(db, pending.id, {
      taskText: input.updateBody,
      parentSessionId: input.reporterSessionId,
      workspaceName: input.reporterLabel,
    })
    if (replaced !== null) return replaced.id
  }

  const id = randomUUID()
  insertDelegationJob(db, {
    id,
    userId: input.userId,
    parentSessionId: input.reporterSessionId,
    workspaceId: requesterWorkspaceId,
    workspacePath: requester.kind === 'workspace-primary' ? requester.workspacePath : null,
    workspaceName: input.reporterLabel,
    targetPrimarySessionId: requesterPrimarySessionId,
    taskText: input.updateBody,
    partialSessionId,
    threadId,
    status: 'pending',
    claimedAt: null,
    completedAt: null,
    resultText: null,
    errorMessage: null,
    surfacedToRootAt: null,
    originChannelId: null,
    originExternalSenderId: null,
    originExternalChatContextId: null,
    permissionMode: null,
    model: null,
    thinkingEffort: null,
    jobKind: 'update-delivery',
    createdAt: now,
  })
  return id
}
