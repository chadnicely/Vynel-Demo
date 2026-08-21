// `enqueueWorkspaceDelegation` — inserts a PENDING `delegation_jobs` row and
// returns its id. The enqueue half of the durable FIFO work queue: an input
// surface (route, channel, schedule, voice) hands a workspace task to the queue;
// a worker later claims it atomically (`claimNextPendingDelegationJob`) and runs
// it. Kept deliberately decoupled from any one surface so every caller shares one
// enqueue path.
//
// SYNC (not async) — better-sqlite3 repos are synchronous, matching the sibling
// sync op `recordDelegation`. The `id` +
// `createdAt` are generated HERE (the core layer owns UUID generation per the
// locked `id()`-has-no-DEFAULT contract); every reserved/terminal column is
// nulled at enqueue time.

import { randomUUID } from 'node:crypto'
import type { Database } from '@vynel/db'
import { resolveThreadId } from './resolve-thread-id.js'
import type { ThinkingEffortLevel } from '@vynel/contracts/chat/thinking-effort'
import { insertDelegationJob } from '../repositories/index.js'
import type { DelegationPermissionMode } from '../orchestration-types.js'

/** The channel a delegation was requested from (brain-tree Ch4) — carried so the report is
 *  delivered back to where the user asked. All fields are LOOSE refs (channels is another
 *  domain). `externalChatContextId` is the delivery address; `externalSenderId` is who asked. */
export interface DelegationOrigin {
  channelId: string
  externalSenderId: string
  externalChatContextId: string
  /** The asking message's external id — set for GROUP messages only, so a
   *  channel reply can thread onto whoever asked. Job enqueues ignore it (the
   *  columns carry the three addresses above); it rides the ambient origin
   *  header for the reply_to_channel tool. */
  externalMessageId?: string
  /** WHICH TURN owns the replies made through this origin — the inbound
   *  message id for a channel turn, the delivery job id for a notify turn.
   *  Stamped on every outbound row `reply_to_channel` queues, so the
   *  zero-reply fallback can tell this turn's answer from a sibling turn's in
   *  the same chat. Same rules as `externalMessageId`: header-only, never a
   *  column, job enqueues ignore it. */
  turnCorrelationId?: string
}

export interface EnqueueWorkspaceDelegationInput {
  /** The chain this hop continues — one task and everything it caused. Omit to
   *  START a chain (the hop becomes its own thread). See `resolveThreadId`. */
  threadId?: string
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
  /** The permission mode the routed turn runs under (surface-up step 1) — the delegating
   *  turn's mode. Omit for the pre-mode default (`bypass-with-behavior-gate`). */
  permissionMode?: DelegationPermissionMode
  /** The root's model pick for the routed turn. Omit for the provider default. */
  model?: string
  /** The root's thinking-effort pick for the routed turn. Omit for the adaptive default. */
  thinkingEffort?: ThinkingEffortLevel
  /** WHO asked for this task, and therefore WHERE its report lands: the asking
   *  workspace's primary. Two producers — a `@persona` mention typed in another
   *  workspace's chat (chat-mentions), and a plain workspace-to-workspace send
   *  (the calling workspace). Omit for a global-root send. LOOSE ref, not a FK:
   *  a deleted asker must fail the report over to the root, never cascade the
   *  job away.
   *
   *  Callers are expected not to pass the TARGET workspace as its own asker;
   *  nothing enforces it here, and a self-send is harmless in practice — the
   *  upward resolver's self-guard drops a self-override and the report
   *  terminates at the root instead of looping. */
  requesterWorkspaceId?: string
}

/** Enqueue a workspace delegation as a pending job and return its id. Callable
 *  from ANY input surface (route, channel, schedule, voice) — not glued to the
 *  route. */
export function enqueueWorkspaceDelegation(
  db: Database,
  input: EnqueueWorkspaceDelegationInput,
  /** Injectable clock. Every row this op writes takes its createdAt from ONE
   *  read, and a test can stagger enqueues deterministically — the claim orders
   *  by (createdAt, id), so same-millisecond rows tie-break on a RANDOM uuid. */
  deps: { now?: () => Date } = {},
): string {
  const now = (deps.now ?? (() => new Date()))()
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
