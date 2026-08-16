// `delegateToAgentSession` — the COLLEAGUE runner (persona-sessions arc): runs
// one turn on a configured agent's CONTINUING session. A colleague is a normal
// primary (scope 'agent', keyed by `scopeRef` = the agent slug per grounding)
// that every `@mention` resumes — persona + memory accumulate, and the reply
// arrives in the requester's chat as the persona's own words (send_message),
// never a harvested result. Replaces the throwaway leaf on the mention path.
//
// SAME SHARED PIPELINE as the spawned runner (`consumeSessionEventStream`):
// every row persists LIVE onto the colleague's recorded segment. Differences
// from `delegateToSpawnedSession`, all colleague-shaped:
//   - FRESH-OR-RESUME: a colleague's first turn starts a fresh SDK session
//     (no seeded priming — the persona rides `systemPromptAppend` EVERY turn,
//     so it survives swaps and compaction); later turns resume
//     `currentSdkSessionId`. Both link event-driven on `session-created`.
//   - FIRST SEGMENT: `scope 'agent'`, `visibility 'listed'`, title = the agent
//     name — a colleague is a durable coworker in the sessions panel. Mid-turn
//     swap segments keep the stock hidden presentation (scope 'agent' too);
//     like spawned sessions, the chain identity stays the first listed segment
//     (the pipeline's swap segment carries no continuedFrom link — parity,
//     recorded in the arc notes).
//   - GRANTS: the agent's allow/deny lists apply on EVERY turn (the leaf
//     precedent) — merged with the MCP attachment's denies.
//   - Boundary-pressure (0.85) swap: deferred for parity with spawned targets;
//     mid-turn SDK compaction swaps are handled (relink).

import { randomUUID } from 'node:crypto'
import type { Database } from '@vynel/db'
import type { AiAgentProvider, AiAgentProviderId } from '@vynel/providers'
import {
  recordDelegation,
  ROUTED_LEAF_MAX_CARDED_DENIALS,
  ROUTED_LEAF_WRITE_BLOCKED_NOTE,
  type DelegationPermissionMode,
} from '@vynel/orchestration'
import { consumeSessionEventStream, type ChatTurnEvent } from '@vynel/chat'
import { linkPrimarySessionToSdkSession } from '../continuity/index.js'
import * as primarySessionsRepository from '../repositories/index.js'
import type { Logger } from 'pino'
import type { RoutedApprovalHandler } from './build-routed-approval-handler.js'
import type { TurnEventBroadcaster } from './turn-event-broadcaster.js'
import { publishTurnEventsToSessionChannel } from '../runtime/session-turn-channel.js'
import {
  composeAgentColleaguePrompt,
  composeRoutedTurnSystemPrompt,
  routedTurnMcpSessionFields,
  type RoutedTurnMcpAttachment,
} from './routed-turn-provider-input.js'
import type { ChatMessageSourceKind } from '@vynel/chat/repositories'

export type DelegateToAgentSessionInput = {
  /** The delegating (parent) session — provenance for the monitor edge. */
  parentSessionId: string
  userId: string
  /** The colleague primary (scope 'agent') whose conversation runs the task. */
  targetPrimarySessionId: string
  /** The run cwd — the grounding workspace's folder, else the global root's
   *  hidden user-data dir (the job row's stored path). */
  runCwdPath: string
  /** The agent identity — slug for the monitor edge, name for persona +
   *  attribution, prompt as the persona body. */
  agentSlug: string
  agentName: string
  agentPrompt: string
  /** The agent's tool grants — applied on EVERY colleague turn. */
  agentAllowedTools?: string[]
  agentDisallowedTools?: string[]
  /** The task/message the colleague absorbs this turn. */
  taskText: string
  /** The system steer for the resumed turn — the note branch passes
   *  `NOTE_DELIVERY_INSTRUCTIONS` (same machinery, different voice). Omit for
   *  the routed-task steer. */
  steerInstructions?: string
  /** Who sent it — the inbound row's attribution (the mention's origin chat). */
  userAttribution?: {
    userSourceKind: ChatMessageSourceKind
    userSourceLabel?: string
  }
  providerId: AiAgentProviderId
  model?: string
  thinkingEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  /** The delegation trace key — stamped on every row the turn persists. */
  partialSessionId?: string
  /** The delegation CHAIN key — per-task, carried across hops (persona-sessions). */
  threadId?: string
  permissionMode?: DelegationPermissionMode
  mcpAttachment?: RoutedTurnMcpAttachment
  approvalHandler?: Pick<RoutedApprovalHandler, 'onApprovalRequested' | 'onApprovalResolved'>
  observer?: {
    onTurnEvent: (event: ChatTurnEvent) => void
    onTurnEnded: () => void
  }
  turnEvents?: TurnEventBroadcaster
  onSessionResolved?: (sdkSessionId: string) => void
  logger?: Logger
}

export type DelegateToAgentSessionResult = {
  /** The colleague's SDK session id after the turn (post-swap when one happened). */
  reference: string
  /** The colleague's clean answer text (the tick records it on the job row;
   *  the SPOKEN path to the requester is the colleague's own send_message). */
  resultText: string
}

export async function delegateToAgentSession(
  db: Database,
  provider: AiAgentProvider,
  input: DelegateToAgentSessionInput,
): Promise<DelegateToAgentSessionResult> {
  // 1. Resolve the colleague primary. Throws → the tick fails the job: a
  //    deleted/foreign/mis-scoped target must never silently run elsewhere.
  const primary = primarySessionsRepository.findPrimarySessionById(db, input.targetPrimarySessionId)
  if (primary === null || primary.userId !== input.userId) {
    throw new Error(
      `delegateToAgentSession: colleague ${input.targetPrimarySessionId} not found or not owned`,
    )
  }
  if (primary.scope !== 'agent') {
    throw new Error(
      `delegateToAgentSession: primary ${input.targetPrimarySessionId} is scope '${primary.scope}', not 'agent'`,
    )
  }

  // 2. Fresh-or-resume: the first turn has no linked SDK session (get-or-create
  //    makes the identity row synchronously, no provider call) — start fresh;
  //    every later turn resumes the colleague's continuing conversation.
  const resumeSessionId = primary.currentSdkSessionId
  const isNewSession = resumeSessionId === null

  const systemPromptAppend = `${composeAgentColleaguePrompt(input.agentName, input.agentPrompt)}\n\n${composeRoutedTurnSystemPrompt(input.mcpAttachment, input.steerInstructions)}`
  const mcpFields = routedTurnMcpSessionFields(input.mcpAttachment)
  const sessionEventStream = provider.startChatSession({
    workspacePath: input.runCwdPath,
    ...(resumeSessionId !== null ? { resumeSessionId } : {}),
    userMessageText: input.taskText,
    systemPromptAppend,
    permissionMode: input.permissionMode ?? 'bypass-with-behavior-gate',
    allowedToolNames: input.agentAllowedTools ?? [],
    ...mcpFields,
    // The agent's own denies join the attachment's (the leaf precedent) — the
    // spread above must not silently drop either list.
    deniedToolNames: [...(input.agentDisallowedTools ?? []), ...mcpFields.deniedToolNames],
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.thinkingEffort !== undefined ? { thinkingEffort: input.thinkingEffort } : {}),
  })

  // 3. Consume through the shared pipeline. The FIRST segment is the
  //    colleague's identity row (listed, named); swap segments stay hidden.
  const turnStream = consumeSessionEventStream({
    db,
    sessionEventStream,
    userMessageInput: { id: randomUUID(), body: input.taskText, attachedImagesMetadata: null },
    userId: input.userId,
    workspaceId: primary.workspaceId,
    workspacePath: input.runCwdPath,
    providerId: input.providerId,
    isNewSession,
    ...(resumeSessionId !== null ? { resumeSessionId } : {}),
    newSessionOptions: isNewSession
      ? { visibility: 'listed', title: input.agentName, skipAutoTitle: true, scope: 'agent' }
      : { visibility: 'hidden', title: 'Continued conversation', skipAutoTitle: true, scope: 'agent' },
    messageAttribution: {
      ...(input.partialSessionId !== undefined ? { partialSessionId: input.partialSessionId } : {}),
      ...(input.threadId !== undefined ? { threadId: input.threadId } : {}),
      ...(input.userAttribution !== undefined
        ? {
            userSourceKind: input.userAttribution.userSourceKind,
            ...(input.userAttribution.userSourceLabel !== undefined
              ? { userSourceLabel: input.userAttribution.userSourceLabel }
              : {}),
          }
        : {}),
      assistantSourceKind: 'agent',
      assistantSourceLabel: input.agentName,
    },
    ...(input.logger !== undefined ? { logger: input.logger } : {}),
  })

  // 4. Drive the stream — the spawned runner's loop: link on create/swap,
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
        input.logger?.warn({ err: observerErr }, 'agent-session turn observer failed on an event')
      }
      switch (event.kind) {
        case 'user-message-persisted':
          sessionId = event.message.sessionId
          input.onSessionResolved?.(event.message.sessionId)
          break
        case 'session-created':
          // The first turn's fresh session AND a mid-turn compaction swap both
          // land here — advance the colleague's link so the next mention
          // resumes THIS segment (event-driven, the spawned-runner shape).
          sessionId = event.session.id
          linkPrimarySessionToSdkSession(db, {
            primarySessionId: primary.id,
            userId: input.userId,
            sdkSessionId: event.session.id,
          })
          input.onSessionResolved?.(event.session.id)
          break
        case 'session-interrupted':
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
    // Fail CLOSED on a mid-turn pipeline throw (the spawned-runner shape).
    if (sessionId !== null) {
      try {
        await provider.interruptChatSession(sessionId)
      } catch (interruptErr) {
        input.logger?.warn(
          { err: interruptErr, sessionId },
          'delegateToAgentSession: interrupt-on-throw failed (the reaper bounds recorded cards)',
        )
      }
    }
    throw err
  } finally {
    try {
      input.observer?.onTurnEnded()
    } catch (observerErr) {
      input.logger?.warn({ err: observerErr }, 'agent-session turn observer failed on end')
    }
  }

  if (sessionId === null) {
    throw new Error(
      'delegateToAgentSession: the runtime did not assign a session id for the colleague turn',
    )
  }
  if (streamError !== null) {
    throw new Error(
      `delegateToAgentSession: the colleague turn errored (${streamError.code}): ${streamError.message}`,
    )
  }
  if (wasInterrupted && !trippedBreaker) {
    throw new Error('delegateToAgentSession: the colleague turn was interrupted')
  }

  // 5. The parent→colleague tree edge for the monitor (role = the slug, the
  //    leaf precedent).
  recordDelegation(db, {
    parentSessionId: input.parentSessionId,
    childSessionId: sessionId,
    role: input.agentSlug,
    userId: input.userId,
  })

  const cleaned = resultText.trim()
  if (trippedBreaker) {
    return {
      reference: sessionId,
      resultText:
        cleaned === '' ? ROUTED_LEAF_WRITE_BLOCKED_NOTE : `${cleaned}\n\n${ROUTED_LEAF_WRITE_BLOCKED_NOTE}`,
    }
  }
  return { reference: sessionId, resultText: cleaned }
}
