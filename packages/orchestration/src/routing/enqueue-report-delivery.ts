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
// (the only kind permitted to carry no target at all), and
// `targetPrimarySessionId` set (workspace columns null) = the VOICE thread's
// continuing conversation (voice-requester routing, 2026-08-27): the spoken
// twin is workspace-less like the root but is its OWN conversation, so its
// reports need an address of their own. Spawned sessions and colleagues remain
// leaves — they send reports, they never receive them (the creator graph is a
// tree that terminates at the global root; the voice thread sits beside the
// root, not below it).
//
// Column reuse (the module notes' shape): `taskText` carries the REPORT body,
// `workspaceName` the CHILD's composed source label, `parentSessionId` the
// REPORTER's sdk session id (provenance — the "from" side).
//
// ORIGIN CHANNEL (channel report protocol, Kafi 2026-08-22): a delivery row MAY
// now carry the origin columns, and they mean what they mean everywhere else —
// "a channel message drove this". They used to be hard-nulled here because task
// completion shipped the channel line itself; that shortcut is gone, so the
// requester's notify turn is what answers the channel, and it needs the address.

import { randomUUID } from 'node:crypto'
import type { Database } from '@vynel/db'
import { resolveThreadId } from './resolve-thread-id.js'
import { insertDelegationJob } from '../repositories/index.js'
import type { DelegationOrigin } from './enqueue-workspace-delegation.js'

/** Who receives the notify turn — the conversation that requested the work. */
export type ReportDeliveryRequester =
  | {
      kind: 'workspace-primary'
      workspaceId: string
      /** The requester workspace's folder — the notify turn's run cwd. */
      workspacePath: string
    }
  | { kind: 'global-root' }
  | {
      kind: 'voice'
      /** The spoken twin's stable primary id (`primary_sessions`, scope
       *  'voice') — the delivery row's `targetPrimarySessionId`, so the tick
       *  runs the notify turn on the VOICE thread, never the global root. */
      voicePrimarySessionId: string
    }

export interface EnqueueReportDeliveryInput {
  /** The chain this hop continues — one task and everything it caused. Omit to
   *  START a chain (the hop becomes its own thread). See `resolveThreadId`. */
  threadId?: string
  userId: string
  /** The REPORTER's (child's) current sdk session id — provenance, stored in
   *  `parentSessionId` (a LOOSE text ref, never a FK). SYSTEM producers pass
   *  a synthetic `<producer>:<id>` (`task:`/`schedule:`/`monitor:`) — that
   *  prefix is LOAD-BEARING: `isSystemReporterSessionId` keys the delivery's
   *  system marker/steer and its quiet UI rendering off it. */
  reporterSessionId: string
  /** The child's composed display label ("Mark · Acme" / the session name) —
   *  the notify turn's inbound `sourceLabel`. */
  reporterLabel: string
  /** The report body — the notify turn's inbound message (already distilled
   *  upstream when it came off a completed task; NO further distill happens). */
  reportBody: string
  requester: ReportDeliveryRequester
  /** Kind `direct_to_user`: the row becomes a 'direct-delivery' — the body is
   *  addressed to the USER and persists straight onto the requester's
   *  transcript as the sender speaking (no notify turn; the requester absorbs
   *  it via the catch-up net). Same queue, claim, and retry machinery. */
  deliverDirectly?: boolean
  /** The CHANNEL that drove the work this report is about — carried so the
   *  requester's notify turn can reply where the user actually asked
   *  (`reply_to_channel` reads it as ambient origin). Omit for chat/voice work
   *  with no external conversation waiting. */
  origin?: DelegationOrigin
}

/** Enqueue a report-delivery job for the requester and return its id. */
export function enqueueReportDelivery(
  db: Database,
  input: EnqueueReportDeliveryInput,
  /** Injectable clock. Every row this op writes takes its createdAt from ONE
   *  read, and a test can stagger enqueues deterministically — the claim orders
   *  by (createdAt, id), so same-millisecond rows tie-break on a RANDOM uuid. */
  deps: { now?: () => Date } = {},
): string {
  if (input.reportBody.trim() === '') {
    throw new Error('enqueueReportDelivery: reportBody must be non-empty')
  }
  if (input.reporterSessionId.trim() === '') {
    throw new Error('enqueueReportDelivery: reporterSessionId must be a non-empty id')
  }
  const now = (deps.now ?? (() => new Date()))()
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
    targetPrimarySessionId: requester.kind === 'voice' ? requester.voicePrimarySessionId : null,
    taskText: input.reportBody,
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
    permissionMode: null,
    model: null,
    thinkingEffort: null,
    jobKind: input.deliverDirectly === true ? 'direct-delivery' : 'report-delivery',
    createdAt: now,
  })
  return id
}
