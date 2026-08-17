// `delegateToWorkspaceRoot` — the session-tier composition for routing a task INTO a
// workspace's CONTINUING PRIMARY conversation (brain-tree Phase 1). Resumes the
// workspace's OWN brain (its primary session, with its context), so "hey jarvis, in
// Acme, summarize the notes" reaches Acme's actual conversation.
//
// THE ROUTED TURN RUNS THROUGH THE ONE SHARED PIPELINE (`consumeSessionEventStream`)
// — the same path every other turn type uses — so everything persists LIVE: the task
// row lands at session-started (attributed "From Global" + the trace key), the reply
// grows chunk-by-chunk, TOOL CALLS and thinking persist as they happen. The workspace
// chat and the Watch panel read it in realtime; nothing waits for completion. (The
// old raw drain + flat completion rows — `recordDelegatedRootMessages` — are gone.)
//
// APPROVALS (surface-up): the pipeline RECORDS each card (workspace-scoped, rules
// evaluated) and parks; the injected handler surfaces it (origin channel + wait
// gate). The denial circuit-breaker lives in the consume loop here: two denied
// decisions in one turn interrupt the leaf (retry-loop guard), ending with the
// clean blocked note.

import { randomUUID } from 'node:crypto'
import type { Database } from '@vynel/db'
import type { AiAgentProvider, AiAgentProviderId } from '@vynel/providers'
import {
  recordDelegation,
  ROUTED_LEAF_MAX_CARDED_DENIALS,
  ROUTED_LEAF_WRITE_BLOCKED_NOTE,
  type DelegationPermissionMode,
} from '@vynel/orchestration'
import {
  consumeSessionEventStream,
  composeManagerSourceLabel,
  type ChatTurnEvent,
} from '@vynel/chat'
import { buildCompactionCapture, linkPrimarySessionToSdkSession } from '../continuity/index.js'
import { resolvePrimaryConversationTarget } from '../runtime/index.js'
import { applyPrimaryTurnContinuityBestEffort } from '../runtime/apply-primary-turn-continuity.js'
import type { Logger } from 'pino'
import type { RoutedApprovalHandler } from './build-routed-approval-handler.js'
import type { TurnEventBroadcaster } from './turn-event-broadcaster.js'
import { publishTurnEventsToSessionChannel } from '../runtime/session-turn-channel.js'
import {
  composeRoutedTurnSystemPrompt,
  routedTurnMcpSessionFields,
  type RoutedTurnMcpAttachment,
} from './routed-turn-provider-input.js'

export type DelegateToWorkspaceRootInput = {
  /** The delegating (parent) session — the global root's current SDK session id. */
  parentSessionId: string
  userId: string
  /** The workspace whose ROOT brain handles the task. */
  workspaceId: string
  /** The workspace folder on disk — the root's cwd. */
  workspacePath: string
  /** The workspace name — the reply attribution's `sourceLabel` base. */
  workspaceName: string
  /** The workspace manager's persona name (brain-tree Ch5) — composes "Mark · vynel".
   *  Absent → just the workspace name. */
  managerName?: string
  /** The task the global root delegates. */
  taskText: string
  /** The provider id stamped on the persisted rows. */
  providerId: AiAgentProviderId
  /** Optional model override for the delegated turn. */
  model?: string
  /** Optional thinking-effort override for the delegated turn — the SDK levels
   *  (the run-global-root-turn-core precedent). Omit for the adaptive default. */
  thinkingEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  /** The delegation request's correlation key (brain-tree Chapter 2) — stamped on
   *  every row the turn persists so the chain is queryable as one trace. */
  partialSessionId?: string
  /** The delegation CHAIN key — stamped beside the per-hop trace key on every
   *  row the turn persists (persona-sessions: the UI's settle-match key). */
  threadId?: string
  /** The permission mode the routed turn runs under (surface-up step 1) — from the
   *  job row. Omit for the pre-mode default (`bypass-with-behavior-gate`). */
  permissionMode?: DelegationPermissionMode
  /** The background workspace MCP attachment (the tick composes it at the api
   *  edge). Omit → the turn runs bare, stripping the session's deferred MCP
   *  tools — only acceptable for a target that never had them. */
  mcpAttachment?: RoutedTurnMcpAttachment
  /** REPORT-DELIVERY variant (session-comms): attribute the INBOUND row as
   *  coming from the reporting CHILD instead of the default 'global-root' task
   *  shape. Omit → the shipped task attribution, byte-for-byte. */
  inboundAttribution?: { sourceKind: 'workspace-manager'; sourceLabel: string }
  /** The origin scope's display name for the TASK shape's anchor row
   *  ("Claude · from <label>" — redesign Phase-2b); ignored when
   *  `inboundAttribution` overrides (a notify turn speaks as its child). */
  userSourceLabel?: string
  /** REPORT-DELIVERY variant: the system steer for this routed turn. Omit →
   *  `ROUTED_TASK_INSTRUCTIONS` (the shipped task steer). */
  steerInstructions?: string
  /** The surface-up handler (the tick's `buildRoutedApprovalHandler`): channel push +
   *  wait-gate edges. Recording happens inside the pipeline either way — without a
   *  handler a carded tool still parks on the recorded card, bounded by the approvals
   *  reaper (no instant auto-deny; production always injects). */
  approvalHandler?: Pick<RoutedApprovalHandler, 'onApprovalRequested' | 'onApprovalResolved'>
  /** Live observing (the SSE observe route): every ChatTurnEvent this turn drives is
   *  forwarded, and `onTurnEnded` fires when the stream finishes — drained OR threw
   *  (the observe stream closes either way). Omit → no observers. */
  observer?: {
    onTurnEvent: (event: ChatTurnEvent) => void
    onTurnEnded: () => void
  }
  /** The shared live-turn pub/sub — when present, the routed turn's events
   *  ALSO tee onto the workspace session's `session:<id>` channel (Watch
   *  everywhere, Slice ③). The job-keyed trace observer above stays — the
   *  stop path and the Watch-a-task panel anchor on it. */
  turnEvents?: TurnEventBroadcaster
  /** The RUNNING SDK session id, as learned (and re-learned on a mid-turn swap) —
   *  the tick feeds the cancel registry with it so a user Stop can interrupt
   *  exactly this session. */
  onSessionResolved?: (sdkSessionId: string) => void
  logger?: Logger
}

export type DelegateToWorkspaceRootResult = {
  /** The workspace root's session reference (its SDK session id). */
  reference: string
  /** The workspace root's clean answer — what the global root absorbs. */
  resultText: string
}

export async function delegateToWorkspaceRoot(
  db: Database,
  provider: AiAgentProvider,
  input: DelegateToWorkspaceRootInput,
): Promise<DelegateToWorkspaceRootResult> {
  // 1. Resolve the workspace's continuing primary + the SDK session to resume.
  const target = await resolvePrimaryConversationTarget(db, {
    userId: input.userId,
    workspaceId: input.workspaceId,
  })

  // 2. Start the provider turn — resume the workspace's brain, or fresh on first use.
  //    The MCP attachment rides along so the resumed session keeps the SAME
  //    background toolset a schedule fire attaches — never a bare turn that
  //    strips the session's deferred tools ("server disconnected").
  const sessionEventStream = provider.startChatSession({
    workspacePath: input.workspacePath,
    ...(target.resumeSdkSessionId !== null
      ? { resumeSessionId: target.resumeSdkSessionId }
      : {}),
    userMessageText: input.taskText,
    systemPromptAppend: composeRoutedTurnSystemPrompt(input.mcpAttachment, input.steerInstructions),
    permissionMode: input.permissionMode ?? 'bypass-with-behavior-gate',
    // Empty grants: a resumed root keeps the workspace's existing tool grants; a
    // fresh root gets the SDK defaults. The behavior gate still cards the floor.
    allowedToolNames: [],
    ...routedTurnMcpSessionFields(input.mcpAttachment),
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.thinkingEffort !== undefined ? { thinkingEffort: input.thinkingEffort } : {}),
    // Layer-1 capture (session.compacted) — the same hook every runner binds.
    onCompaction: buildCompactionCapture(db, input.logger !== undefined ? { logger: input.logger } : {}),
  })

  // 3. Consume through the shared pipeline — every row persists as it streams,
  //    attributed like the old completion rows were (task "From Global", replies
  //    as the workspace manager, everything trace-keyed).
  const turnStream = consumeSessionEventStream({
    db,
    sessionEventStream,
    userMessageInput: { id: randomUUID(), body: input.taskText, attachedImagesMetadata: null },
    userId: input.userId,
    workspaceId: input.workspaceId,
    workspacePath: input.workspacePath,
    providerId: input.providerId,
    isNewSession: target.resumeSdkSessionId === null,
    // Durability-first: a resumed turn's task row persists before provider
    // startup (the unbounded hang point), so a stuck start never loses it.
    ...(target.resumeSdkSessionId !== null ? { resumeSessionId: target.resumeSdkSessionId } : {}),
    // The routed segment keeps the swap-segment presentation (the old
    // recordSwapSegmentSession shape): hidden from the curated sidebar — the
    // continuing brain shows as ONE entry — and never auto-titled (it is the
    // primary thread, not a user-named conversation).
    newSessionOptions: { visibility: 'hidden', title: 'Continued conversation', skipAutoTitle: true },
    messageAttribution: {
      ...(input.partialSessionId !== undefined
        ? { partialSessionId: input.partialSessionId }
        : {}),
      ...(input.threadId !== undefined ? { threadId: input.threadId } : {}),
      // A notify turn's inbound row is attributed FROM the reporting child
      // (session-comms); the default is the shipped task shape ('global-root').
      userSourceKind: input.inboundAttribution?.sourceKind ?? 'global-root',
      ...(input.inboundAttribution !== undefined
        ? { userSourceLabel: input.inboundAttribution.sourceLabel }
        : input.userSourceLabel !== undefined
          ? { userSourceLabel: input.userSourceLabel }
          : {}),
      assistantSourceKind: 'workspace-manager',
      assistantSourceLabel: composeManagerSourceLabel(input.workspaceName, input.managerName),
    },
    ...(input.logger !== undefined ? { logger: input.logger } : {}),
  })

  // 4. Drive the stream: link the primary on a new/swapped segment, accumulate the
  //    clean result, surface approvals, and trip the denial breaker.
  let sessionId: string | null = null
  let resultText = ''
  let cardedDenials = 0
  let trippedBreaker = false
  let wasInterrupted = false
  let streamError: { code: string; message: string } | null = null

  // Tee onto the workspace session's live channel when a broadcaster is wired.
  const observedTurnStream =
    input.turnEvents !== undefined
      ? publishTurnEventsToSessionChannel(turnStream, input.turnEvents)
      : turnStream

  try {
    for await (const event of observedTurnStream) {
      // Contained: a broken observer must never break the producing turn (the
      // broadcaster already guards its subscribers; this guards the seam itself).
      try {
        input.observer?.onTurnEvent(event)
      } catch (observerErr) {
        input.logger?.warn({ err: observerErr }, 'routed-turn observer failed on an event')
      }
      switch (event.kind) {
        case 'user-message-persisted':
          // Fires on BOTH the new and resumed branches — every turn sets it.
          sessionId = event.message.sessionId
          input.onSessionResolved?.(event.message.sessionId)
          break
        case 'session-created':
          // A fresh root OR a compaction swap — advance the primary's link so the
          // next delegation resumes THIS segment (the P0.1 id-based gate, now
          // event-driven like the global-root core). The local sessionId must
          // follow too: the interrupt/denial-breaker targets it, and the registry
          // holds the POST-swap id (the early user-message-persisted now carries
          // the pre-swap id).
          sessionId = event.session.id
          linkPrimarySessionToSdkSession(db, {
            primarySessionId: target.primarySessionId,
            userId: input.userId,
            sdkSessionId: event.session.id,
          })
          input.onSessionResolved?.(event.session.id)
          break
        case 'session-interrupted':
          // An EXTERNAL interrupt (the user's Stop) — remembered so the drain
          // below fails the turn instead of returning the partial text as a
          // clean result (an interrupted stream otherwise drains "normally").
          // The denial breaker's own interrupt is excluded at the check site.
          wasInterrupted = true
          break
        case 'text-chunk':
          resultText += event.textDelta
          break
        case 'approval-requested':
          input.approvalHandler?.onApprovalRequested(event)
          break
        case 'approval-resolved': {
          input.approvalHandler?.onApprovalResolved(event)
          // Breaker on DENIALS (user, reaper, or fallback): the leaf keeps proposing
          // irreversible actions past the denials — interrupt it ONCE so it fails
          // fast instead of burning the route timeout. Approvals never count.
          if (event.decision.kind === 'denied') {
            cardedDenials += 1
            if (
              !trippedBreaker &&
              sessionId !== null &&
              cardedDenials >= ROUTED_LEAF_MAX_CARDED_DENIALS
            ) {
              trippedBreaker = true
              await provider.interruptChatSession(sessionId)
            }
          }
          break
        }
        case 'session-errored':
          streamError = { code: event.errorCode, message: event.errorMessage }
          break
        default:
          break // tool/thinking/usage/title events persist inside the pipeline
      }
    }
  } catch (err) {
    // The pipeline threw mid-turn (e.g. an approval record failed before it could be
    // yielded/parked). Fail CLOSED: interrupt the leaf session so the provider cancels
    // any pending canUseTool Promise — never a background agent parked on a card no
    // surface can see. Best-effort; the rethrow carries the real failure.
    if (sessionId !== null) {
      try {
        await provider.interruptChatSession(sessionId)
      } catch (interruptErr) {
        input.logger?.warn(
          { err: interruptErr, sessionId },
          'delegateToWorkspaceRoot: interrupt-on-throw failed (the reaper bounds recorded cards)',
        )
      }
    }
    throw err
  } finally {
    // Drained OR threw — either way the turn is over for its observers. Contained:
    // a throw here would MASK the turn's real error.
    try {
      input.observer?.onTurnEnded()
    } catch (observerErr) {
      input.logger?.warn({ err: observerErr }, 'routed-turn observer failed on end')
    }
  }

  if (sessionId === null) {
    // A provider that dies BEFORE session-started surfaces here — the pipeline only
    // emits `session-errored` once a session exists (its contract), so the id is all
    // we can report.
    throw new Error(
      'delegateToWorkspaceRoot: the runtime did not assign a session id for the routed turn',
    )
  }

  // Continuity at the turn boundary — the ONE op every continuing identity
  // runs (the interactive stream + the global core call the same). Under the
  // tick's target lock, so a swap lands before the next task resumes this
  // brain; a background-driven workspace no longer rides to the ceiling
  // waiting for an interactive turn to measure it. Best-effort: the turn's
  // rows are persisted — a failure is logged and the outcome below is
  // reported as it happened.
  await applyPrimaryTurnContinuityBestEffort(
    db,
    {
      primarySessionId: target.primarySessionId,
      priorSdkSessionId: target.resumeSdkSessionId,
      effectiveSdkSessionId: sessionId,
      userId: input.userId,
      workspacePath: input.workspacePath,
      providerId: input.providerId,
    },
    { provider, ...(input.logger !== undefined ? { logger: input.logger } : {}) },
  )

  if (streamError !== null) {
    throw new Error(
      `delegateToWorkspaceRoot: the routed turn errored (${streamError.code}): ${streamError.message}`,
    )
  }
  // An external interrupt is a STOP, not a result — throw so the tick fails
  // the job and never pushes the partial text as a green report. The denial
  // breaker's own interrupt keeps its existing blocked-note return below.
  if (wasInterrupted && !trippedBreaker) {
    throw new Error('delegateToWorkspaceRoot: the routed turn was interrupted')
  }

  // 5. The parent→child tree edge (global root → workspace root) for the monitor.
  recordDelegation(db, {
    parentSessionId: input.parentSessionId,
    childSessionId: sessionId,
    role: 'workspace-root',
    userId: input.userId,
  })

  // Tripped the breaker → end with the clean blocked note, preserving any text the
  // leaf produced (never an empty result the root can't relay).
  const cleaned = resultText.trim()
  if (trippedBreaker) {
    return {
      reference: sessionId,
      resultText: cleaned === '' ? ROUTED_LEAF_WRITE_BLOCKED_NOTE : `${cleaned}\n\n${ROUTED_LEAF_WRITE_BLOCKED_NOTE}`,
    }
  }
  return { reference: sessionId, resultText: cleaned }
}
