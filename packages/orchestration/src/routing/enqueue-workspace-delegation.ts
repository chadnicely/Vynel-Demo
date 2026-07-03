// `enqueueWorkspaceDelegation` — inserts a PENDING `delegation_jobs` row and
// returns its id. The enqueue half of the durable FIFO work queue: an input
// surface (route, channel, schedule, voice) hands a workspace task to the queue;
// a worker later claims it atomically (`claimNextPendingDelegationJob`) and runs
// it. Kept deliberately decoupled from any one surface so every caller shares one
// enqueue path.
//
// SYNC (not async) — better-sqlite3 repos are synchronous, matching the sibling
// sync ops `recordDelegation` + `recordDelegatedRootMessages`. The `id` +
// `createdAt` are generated HERE (the core layer owns UUID generation per the
// locked `id()`-has-no-DEFAULT contract); every reserved/terminal column is
// nulled at enqueue time.

import { randomUUID } from 'node:crypto'
import type { Database } from '@vynel/db'
import { insertDelegationJob } from '../repositories/index.js'

/** The channel a delegation was requested from (brain-tree Ch4) — carried so the report is
 *  delivered back to where the user asked. All fields are LOOSE refs (channels is another
 *  domain). `externalChatContextId` is the delivery address; `externalSenderId` is who asked. */
export interface DelegationOrigin {
  channelId: string
  externalSenderId: string
  externalChatContextId: string
}

export interface EnqueueWorkspaceDelegationInput {
  userId: string
  /** The enqueue-time global-root SDK session id — a LOOSE text ref, not a FK. */
  parentSessionId: string
  workspaceId: string
  workspacePath: string
  workspaceName: string
  taskText: string
  /** Set when a CHANNEL message drove this delegation (Ch4) — the report is delivered back to
   *  this channel + recipient. Omit for a web/voice-text origin (no channel delivery). */
  origin?: DelegationOrigin
}

/** Enqueue a workspace delegation as a pending job and return its id. Callable
 *  from ANY input surface (route, channel, schedule, voice) — not glued to the
 *  route. */
export function enqueueWorkspaceDelegation(
  db: Database,
  input: EnqueueWorkspaceDelegationInput,
): string {
  const id = randomUUID()
  // The delegation request's correlation key (brain-tree Chapter 2) — minted HERE,
  // once per request, so every message the request later produces (the task, the
  // workspace reply, the pushed report) shares it and the chain is queryable as one
  // trace. DISTINCT from the job id: the job is the queue row; the partialSessionId
  // is the trace key (a retried delegation could reuse it across job rows).
  const partialSessionId = randomUUID()
  insertDelegationJob(db, {
    id,
    userId: input.userId,
    parentSessionId: input.parentSessionId,
    workspaceId: input.workspaceId,
    workspacePath: input.workspacePath,
    workspaceName: input.workspaceName,
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
    createdAt: new Date(),
  })
  return id
}
