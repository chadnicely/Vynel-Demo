// `delegateToSpawnedSession` — the SESSION-target sibling of
// `delegateToWorkspaceRoot` (session-library Slice ④): routes a task INTO a
// SPAWNED session's CONTINUING conversation. A spawned session is a normal
// primary (scope 'spawned', global-grounded) the root created as a tool
// (`create_session`); `send_task_to_session` resumes ITS current SDK session —
// its memory, its primed purpose, its own continuity — never a fresh throwaway.
//
// SAME SHARED PIPELINE as the workspace path (`consumeSessionEventStream`):
// everything persists LIVE onto the spawned session's recorded segment —
// the attributed task row ("From Global" + the trace key), the reply
// chunk-by-chunk, tool calls and thinking. The Sessions panel and the Watch
// panel read it in realtime. Approvals record + park, surfaced by the injected
// handler; the denial circuit-breaker is identical.
//
// Differences from the workspace runner, all target-shaped:
//   - Resolution: `findPrimarySessionById` (owned, scope 'spawned', linked) —
//     the session ALWAYS has a current SDK session (create links it at birth),
//     so this only ever RESUMES. A missing/unlinked target throws → job fails.
//   - Ground: `workspaceId` null; the cwd is the job row's stored run cwd
//     (v1: the global root's hidden user-data dir).
//   - Attribution label: the SESSION'S NAME plays the "manager" role (v1 —
//     recorded as acceptable in the module notes).

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
import { linkPrimarySessionToSdkSession } from '../continuity/index.js'
import * as primarySessionsRepository from '../repositories/index.js'
import type { Logger } from 'pino'
import type { RoutedApprovalHandler } from './build-routed-approval-handler.js'
import type { TurnEventBroadcaster } from './turn-event-broadcaster.js'
import { publishTurnEventsToSessionChannel } from '../runtime/session-turn-channel.js'
import { ROUTED_TASK_INSTRUCTIONS } from './delegate-to-workspace-root.js'

export type DelegateToSpawnedSessionInput = {
  /** The delegating (parent) session — the global root's current SDK session id. */
  parentSessionId: string
  userId: string
  /** The spawned primary session whose conversation handles the task. */
  targetPrimarySessionId: string
  /** The run cwd (the job row's stored path) — the spawned session's SDK cwd. */
  runCwdPath: string
  /** The spawned session's name — the reply attribution's `sourceLabel` (v1: the
   *  session plays the "manager" role in the report chain). */
  sessionName: string
  /** The task the global root delegates. */
  taskText: string
  /** The provider id stamped on the persisted rows. */
  providerId: AiAgentProviderId
  /** Optional model override for the delegated turn. */
  model?: string
  /** The delegation request's correlation key — stamped on every row the turn
   *  persists so the chain is queryable as one trace. */
  partialSessionId?: string
  /** The permission mode the routed turn runs under — from the job row. Omit for
   *  the pre-mode default (`bypass-with-behavior-gate`). */
  permissionMode?: DelegationPermissionMode
  /** The surface-up handler (the tick's `buildRoutedApprovalHandler`). */
  approvalHandler?: Pick<RoutedApprovalHandler, 'onApprovalRequested' | 'onApprovalResolved'>
  /** Live observing (the SSE observe route) — same contract as the workspace runner. */
  observer?: {
    onTurnEvent: (event: ChatTurnEvent) => void
    onTurnEnded: () => void
  }
  /** The shared live-turn pub/sub — the turn's events tee onto the session's
   *  `session:<id>` channel (Watch everywhere). */
  turnEvents?: TurnEventBroadcaster
  /** The RUNNING SDK session id, as learned (and re-learned on a mid-turn swap). */
  onSessionResolved?: (sdkSessionId: string) => void
  logger?: Logger
}

export type DelegateToSpawnedSessionResult = {
  /** The spawned session's session reference (its SDK session id). */
  reference: string
  /** The spawned session's clean answer — what the global root absorbs. */
  resultText: string
}

export async function delegateToSpawnedSession(
  db: Database,
  provider: AiAgentProvider,
  input: DelegateToSpawnedSessionInput,
): Promise<DelegateToSpawnedSessionResult> {
  // 1. Resolve the spawned primary + the SDK session to resume. All three checks
  //    throw (→ the tick fails the job): a deleted/foreign/unlinked target must
  //    never silently run somewhere else.
  const primary = primarySessionsRepository.findPrimarySessionById(db, input.targetPrimarySessionId)
  if (primary === null || primary.userId !== input.userId) {
    throw new Error(
      `delegateToSpawnedSession: spawned session ${input.targetPrimarySessionId} not found or not owned`,
    )
  }
  if (primary.scope !== 'spawned') {
    throw new Error(
      `delegateToSpawnedSession: primary ${input.targetPrimarySessionId} is scope '${primary.scope}', not 'spawned'`,
    )
  }
  if (primary.currentSdkSessionId === null) {
    // Create always links at birth — a null here means a corrupted row.
    throw new Error(
      `delegateToSpawnedSession: spawned session ${input.targetPrimarySessionId} has no linked SDK session`,
    )
  }

  // 2. Resume the spawned session's continuing conversation.
  const sessionEventStream = provider.startChatSession({
    workspacePath: input.runCwdPath,
    resumeSessionId: primary.currentSdkSessionId,
    userMessageText: input.taskText,
    systemPromptAppend: ROUTED_TASK_INSTRUCTIONS,
    permissionMode: input.permissionMode ?? 'bypass-with-behavior-gate',
    // Empty grants: the resumed session keeps its existing tool grants; the
    // behavior gate still cards the floor.
    allowedToolNames: [],
    deniedToolNames: [],
    ...(input.model !== undefined ? { model: input.model } : {}),
  })

  // 3. Consume through the shared pipeline — every row persists as it streams
  //    onto the spawned session's recorded segment.
  const turnStream = consumeSessionEventStream({
    db,
    sessionEventStream,
    userMessageInput: { id: randomUUID(), body: input.taskText, attachedImagesMetadata: null },
    userId: input.userId,
    workspaceId: null,
    workspacePath: input.runCwdPath,
    providerId: input.providerId,
    isNewSession: false,
    // Only reached on a mid-turn SDK swap: the fresh segment keeps the stock
    // hidden swap presentation — the spawned entry's identity stays its first
    // (listed, named) segment.
    newSessionOptions: { visibility: 'hidden', title: 'Continued conversation', skipAutoTitle: true },
    messageAttribution: {
      ...(input.partialSessionId !== undefined
        ? { partialSessionId: input.partialSessionId }
        : {}),
      userSourceKind: 'global-root',
      assistantSourceKind: 'workspace-manager',
      assistantSourceLabel: composeManagerSourceLabel(input.sessionName),
    },
    ...(input.logger !== undefined ? { logger: input.logger } : {}),
  })

  // 4. Drive the stream — identical to the workspace runner: link on swap,
  //    accumulate the clean result, surface approvals, trip the denial breaker.
  let sessionId: string | null = null
  let resultText = ''
  let cardedDenials = 0
  let trippedBreaker = false
  let wasInterrupted = false
  let streamError: { code: string; message: string } | null = null

  const observedTurnStream =
    input.turnEvents !== undefined
      ? publishTurnEventsToSessionChannel(turnStream, input.turnEvents)
      : turnStream

  try {
    for await (const event of observedTurnStream) {
      try {
        input.observer?.onTurnEvent(event)
      } catch (observerErr) {
        input.logger?.warn({ err: observerErr }, 'spawned-session turn observer failed on an event')
      }
      switch (event.kind) {
        case 'user-message-persisted':
          sessionId = event.message.sessionId
          input.onSessionResolved?.(event.message.sessionId)
          break
        case 'session-created':
          // A mid-turn compaction swap — advance the primary's link so the next
          // task resumes THIS segment (event-driven, the workspace-root shape).
          linkPrimarySessionToSdkSession(db, {
            primarySessionId: primary.id,
            userId: input.userId,
            sdkSessionId: event.session.id,
          })
          input.onSessionResolved?.(event.session.id)
          break
        case 'session-interrupted':
          // An EXTERNAL interrupt (the user's Stop) — the drain below fails the
          // turn instead of returning the partial text as a clean result.
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
    // The pipeline threw mid-turn — fail CLOSED: interrupt so the provider
    // cancels any pending canUseTool Promise (best-effort; rethrow carries the
    // real failure).
    if (sessionId !== null) {
      try {
        await provider.interruptChatSession(sessionId)
      } catch (interruptErr) {
        input.logger?.warn(
          { err: interruptErr, sessionId },
          'delegateToSpawnedSession: interrupt-on-throw failed (the reaper bounds recorded cards)',
        )
      }
    }
    throw err
  } finally {
    try {
      input.observer?.onTurnEnded()
    } catch (observerErr) {
      input.logger?.warn({ err: observerErr }, 'spawned-session turn observer failed on end')
    }
  }

  if (sessionId === null) {
    throw new Error(
      'delegateToSpawnedSession: the runtime did not assign a session id for the routed turn',
    )
  }
  if (streamError !== null) {
    throw new Error(
      `delegateToSpawnedSession: the routed turn errored (${streamError.code}): ${streamError.message}`,
    )
  }
  if (wasInterrupted && !trippedBreaker) {
    throw new Error('delegateToSpawnedSession: the routed turn was interrupted')
  }

  // 5. The parent→child tree edge (global root → spawned session) for the monitor.
  recordDelegation(db, {
    parentSessionId: input.parentSessionId,
    childSessionId: sessionId,
    role: 'spawned-session',
    userId: input.userId,
  })

  const cleaned = resultText.trim()
  if (trippedBreaker) {
    return {
      reference: sessionId,
      resultText: cleaned === '' ? ROUTED_LEAF_WRITE_BLOCKED_NOTE : `${cleaned}\n\n${ROUTED_LEAF_WRITE_BLOCKED_NOTE}`,
    }
  }
  return { reference: sessionId, resultText: cleaned }
}
