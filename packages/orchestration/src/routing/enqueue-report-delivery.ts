// `enqueueReportDelivery` — inserts a PENDING `delegation_jobs` row of kind
// 'report-delivery' (session-comms, the revert flow): a child's finished report
// travels UP by running a real NOTIFY turn on the REQUESTER's conversation, with
// the report as the attributed inbound message. Same durable FIFO queue, same
// claim machinery — the tick branches on `jobKind` and runs the notify runner
// instead of the task runner.
//
// ROW INVARIANT (adjusted here, by construction): a 'task' row carries exactly
// ONE target; a 'report-delivery' row targets the REQUESTER — `workspaceId` set
// = that workspace's primary conversation, BOTH targets null = the global root
// (the only kind permitted to carry no target at all). `targetPrimarySessionId`
// is NEVER set on a report-delivery row: spawned sessions are leaves — they send
// reports, they never receive them (the creator graph is a tree that terminates
// at the global root).
//
// Column reuse (the module notes' shape): `taskText` carries the REPORT body,
// `workspaceName` the CHILD's composed source label, `parentSessionId` the
// REPORTER's sdk session id (provenance — the "from" side). Origin-channel
// columns stay null: channel delivery of a completed task's report happens at
// task completion (unchanged); the notify turn is the chat/awareness path only.

import { randomUUID } from 'node:crypto'
import type { Database } from '@vynel/db'
import { insertDelegationJob } from '../repositories/index.js'

/** Who receives the notify turn — the conversation that requested the work. */
export type ReportDeliveryRequester =
  | {
      kind: 'workspace-primary'
      workspaceId: string
      /** The requester workspace's folder — the notify turn's run cwd. */
      workspacePath: string
    }
  | { kind: 'global-root' }

export interface EnqueueReportDeliveryInput {
  userId: string
  /** The REPORTER's (child's) current sdk session id — provenance, stored in
   *  `parentSessionId` (a LOOSE text ref, never a FK). */
  reporterSessionId: string
  /** The child's composed display label ("Mark · Acme" / the session name) —
   *  the notify turn's inbound `sourceLabel`. */
  reporterLabel: string
  /** The report body — the notify turn's inbound message (already distilled
   *  upstream when it came off a completed task; NO further distill happens). */
  reportBody: string
  requester: ReportDeliveryRequester
}

/** Enqueue a report-delivery job for the requester and return its id. */
export function enqueueReportDelivery(db: Database, input: EnqueueReportDeliveryInput): string {
  if (input.reportBody.trim() === '') {
    throw new Error('enqueueReportDelivery: reportBody must be non-empty')
  }
  if (input.reporterSessionId.trim() === '') {
    throw new Error('enqueueReportDelivery: reporterSessionId must be a non-empty id')
  }
  const id = randomUUID()
  // A fresh correlation key per delivery — the notify turn's rows share it, so
  // the delivery is queryable (and watchable) as its own trace, distinct from
  // the task's trace that produced the report.
  const partialSessionId = randomUUID()
  const requester = input.requester
  insertDelegationJob(db, {
    id,
    userId: input.userId,
    parentSessionId: input.reporterSessionId,
    workspaceId: requester.kind === 'workspace-primary' ? requester.workspaceId : null,
    workspacePath: requester.kind === 'workspace-primary' ? requester.workspacePath : null,
    workspaceName: input.reporterLabel,
    targetPrimarySessionId: null,
    taskText: input.reportBody,
    partialSessionId,
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
    jobKind: 'report-delivery',
    createdAt: new Date(),
  })
  return id
}
