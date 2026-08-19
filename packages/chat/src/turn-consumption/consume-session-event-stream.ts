// The session-event translation pipeline — translates the providers'
// `AsyncIterable<NormalizedSessionEvent>` into persisted DB rows + a UI-
// bound `ChatTurnEvent` stream. Every `NormalizedSessionEvent.kind`
// variant is handled per blueprint §6's translation contract table.
//
// Spec: `docs/blueprints/chat/blueprint.md §5.2` + §6 (mapping table) +
// `coding.md §1.4` (per-turn caches, no module-level state) + D15 (mixed
// PK source for chat_messages.id — assistant rows use provider's
// `messageId` as PK).
//
// The two per-turn caches (assistantMessageByMessageId, toolCallByToolUseId)
// are allocated fresh per call — module-level caches would leak memory +
// race between concurrent turns.
//
// User-message persistence: deferred to the `session-started` handler so
// the FK target (`chat_sessions.id`) exists before the user-message row
// lands. The user message INPUT (body + optional images) is passed in;
// `userMessage` is populated on first event, then re-used for the rest of
// the stream (errored-message marking).

import * as chatRepository from '../repositories/index.js'
import { withTransaction } from '@vynel/db'
import type { Database } from '@vynel/db'
import type {
  ApprovalStatus,
  ChatMessage,
  ChatMessageOriginChannel,
  AttachedImageMetadata,
} from '../repositories/index.js'
import type { AiAgentProviderId, NormalizedSessionEvent } from '@vynel/providers'
import { toolOutputForStorage } from '@vynel/contracts/chat/unpersisted-tool-output'
import { generateSessionTitle } from './generate-session-title.js'
import {
  ensureAssistantMessageRow,
  type AssistantRowAttribution,
} from './ensure-assistant-message-row.js'
import { handleSessionStarted } from './handle-session-started.js'
import { handleApprovalRequested } from './handle-approval-requested.js'
import { handleUsageReported } from './handle-usage-reported.js'
import { persistTurnFailureRow } from './persist-turn-failure-row.js'
import { createSubagentActivityRecorder } from './record-subagent-activity.js'
import { persistAttachedImages, type AttachedImageBytes } from './attached-images.js'
import type { ChatTurnEvent } from '../chat-turn-event.js'
import type { StructuralLogger, NewSessionOptions } from '../chat-types.js'

export type UserMessageInput = {
  /** Vynel-generated UUID — pre-assigned so optimistic UI on the client matches. */
  id: string
  body: string
  attachedImagesMetadata: AttachedImageMetadata[] | null
  /** Raw image bytes (base64) for disk persistence; metadata above is the DB row shape. */
  attachedImages?: AttachedImageBytes[]
  /** The inbound channel this message arrived through ('voice'/'telegram'/'discord');
   *  omitted = the app composer. Persisted on the user row so the transcript
   *  shows HOW it arrived. */
  originChannel?: ChatMessageOriginChannel
}

export type ConsumeSessionEventStreamInput = {
  db: Database
  sessionEventStream: AsyncIterable<NormalizedSessionEvent>
  userMessageInput: UserMessageInput
  userId: string
  /** Null for a global-root (brain) session — the brain sits above all workspaces.
   *  Only stored on the rows; not branched on (except the approval audit row, which
   *  a workspace-less session forwards without persisting). */
  workspaceId: string | null
  /** Workspace folder — where attached image bytes are persisted for re-display. */
  workspacePath?: string
  providerId: AiAgentProviderId
  isNewSession: boolean
  /** The session this turn resumes (when known). Enables the durability-first
   *  write: the user row persists BEFORE provider startup — the unbounded
   *  spawn/auth/resume round-trip — so a hung or failed start never loses the
   *  message. New sessions still defer to `session-started` (no FK target yet). */
  resumeSessionId?: string
  /** Presentation overrides for the new-session row (the brain passes hidden +
   *  'Global brain' + skipAutoTitle). Omitted by the workspace path → defaults. */
  newSessionOptions?: NewSessionOptions
  /** Attribution stamped on this turn's message rows (surface-up routed turns):
   *  the trace key on every row, 'global-root' on the task, the workspace-manager
   *  identity on the replies. Omitted by direct chat → rows stay null (unchanged). */
  messageAttribution?: TurnMessageAttribution
  logger?: StructuralLogger
}

/** How a turn's persisted rows are attributed — who asked, who answered, and the
 *  delegation trace key linking them (all optional, all additive). */
export type TurnMessageAttribution = {
  partialSessionId?: string
  /** The delegation CHAIN key (persona-sessions) — per-task, carried across
   *  every hop, where `partialSessionId` is per-hop. */
  threadId?: string
  /** The user row's origin (a routed task passes 'global-root'; a report-delivery
   *  notify turn passes 'workspace-manager' — the report comes FROM a child). */
  userSourceKind?: AssistantRowAttribution['sourceKind']
  /** The user row's source label (a notify turn passes the CHILD's name —
   *  "Mark · Acme" / the session name). Omitted → null (unchanged). */
  userSourceLabel?: string
  /** The assistant rows' identity (a routed turn passes 'workspace-manager' + label). */
  assistantSourceKind?: AssistantRowAttribution['sourceKind']
  assistantSourceLabel?: string
}

export async function* consumeSessionEventStream(
  input: ConsumeSessionEventStreamInput,
): AsyncIterable<ChatTurnEvent> {
  const {
    db,
    sessionEventStream,
    userMessageInput,
    userId,
    workspaceId,
    workspacePath,
    providerId,
    isNewSession,
    newSessionOptions,
    messageAttribution,
    logger,
  } = input

  // The assistant-row attribution, built once (the three ensure call sites share it).
  const assistantAttribution: AssistantRowAttribution | undefined =
    messageAttribution !== undefined
      ? {
          ...(messageAttribution.assistantSourceKind !== undefined
            ? { sourceKind: messageAttribution.assistantSourceKind }
            : {}),
          ...(messageAttribution.assistantSourceLabel !== undefined
            ? { sourceLabel: messageAttribution.assistantSourceLabel }
            : {}),
          ...(messageAttribution.partialSessionId !== undefined
            ? { partialSessionId: messageAttribution.partialSessionId }
            : {}),
          ...(messageAttribution.threadId !== undefined
            ? { threadId: messageAttribution.threadId }
            : {}),
        }
      : undefined

  let sessionId: string | null = null
  let userMessage: ChatMessage | null = null

  // Durability-first: a RESUMED turn's user row persists before the provider
  // starts (the historical hang point sat between send and persist, losing the
  // message on every stuck start). Emitted immediately so the client renders it
  // without waiting on the SDK.
  if (input.resumeSessionId !== undefined) {
    const existingSession = chatRepository.findChatSessionById(db, input.resumeSessionId)
    if (existingSession !== null) {
      const resumeSessionId = input.resumeSessionId
      const now = new Date()
      // Find-or-insert by id (session-hardening A3c): a RETRIED delivery turn
      // carries the same inbound id as its first attempt, whose row may already
      // sit on this chain — re-use it, never append the report twice.
      userMessage = withTransaction(db, (tx) => {
        const { message: inserted, inserted: isNew } = chatRepository.insertChatMessageIfAbsent(tx, {
          id: userMessageInput.id,
          sessionId: resumeSessionId,
          role: 'user',
          body: userMessageInput.body,
          sourceKind: messageAttribution?.userSourceKind ?? null,
          sourceLabel: messageAttribution?.userSourceLabel ?? null,
          partialSessionId: messageAttribution?.partialSessionId ?? null,
          threadId: messageAttribution?.threadId ?? null,
          originChannel: userMessageInput.originChannel ?? null,
          thinkingBody: null,
          inputTokens: null,
          outputTokens: null,
          attachedImagesMetadata: userMessageInput.attachedImagesMetadata,
          errorCode: null,
          errorMessage: null,
          startedAt: now,
          completedAt: now, // user messages are "complete" immediately
          createdAt: now,
        })
        if (isNew) chatRepository.updateChatSession(tx, resumeSessionId, { lastMessageAt: now })
        return inserted
      })
      yield { kind: 'user-message-persisted', message: userMessage }
    }
  }
  // The model the session ran with — reported on every assistant message;
  // persisted once on the session (the UI context-window denominator).
  let sessionModel: string | null = null
  // Per-turn caches (coding §1.4) — fresh per call; GC'd when generator exits.
  const assistantMessageByMessageId = new Map<string, ChatMessage>()
  const toolCallByToolUseId = new Map<string, string /* dbId */>()
  // The completion event carries no tool name, but whether an output may be
  // PERSISTED depends on which tool produced it (see `toolOutputForStorage`).
  const toolNameByToolUseId = new Map<string, string>()
  // Approval decisions keyed by the gated call's tool_use id — stamps the row
  // whichever side arrives first (resolve-then-insert or insert-then-resolve),
  // and keeps a DENIED row from being overwritten 'failed' by the SDK's
  // error tool_result that follows every denial.
  const approvalStatusByToolUseId = new Map<string, ApprovalStatus>()
  // Subagent traffic persists onto its spawning Agent call's row (narrative +
  // lean tool list) while the same wire events keep streaming to live viewers.
  const subagentActivity = createSubagentActivityRecorder({
    db,
    toolCallByToolUseId,
    logger,
  })

  try {
    for await (const event of sessionEventStream) {
      switch (event.kind) {
        case 'session-started': {
          const result = handleSessionStarted({
            db,
            event,
            userMessageInput,
            userId,
            workspaceId,
            providerId,
            isNewSession,
            // The resumed id lets the handler recognize a mid-turn compaction
            // swap (a session-started reporting a DIFFERENT id) and chain the
            // created row to its predecessor (session-review B4).
            ...(input.resumeSessionId !== undefined
              ? { resumeSessionId: input.resumeSessionId }
              : {}),
            ...(userMessage !== null ? { alreadyPersistedUserMessage: userMessage } : {}),
            ...(newSessionOptions !== undefined ? { newSessionOptions } : {}),
            ...(messageAttribution !== undefined ? { messageAttribution } : {}),
          })
          // A mid-turn swap lands the rest of the turn on a NEW segment whose
          // row has no model yet — reset the "already persisted" model state so
          // the next usage report writes it there too. Without this the fresh
          // segment ended the turn with model NULL, and the boundary continuity
          // step then measured it against the 200k floor (a false early swap on
          // a 1M model) and distilled on the CLI default.
          if (result.sessionId !== sessionId) sessionModel = null
          sessionId = result.sessionId
          userMessage = result.userMessage
          // Persist attached image bytes now that the real session id exists (a
          // new session's id isn't known until the SDK assigns it). Best-effort:
          // the provider already got the images inline, so a disk hiccup must not
          // fail the turn — it only affects re-display when the session reopens.
          if (workspacePath && userMessageInput.attachedImages?.length) {
            try {
              await persistAttachedImages({
                workspacePath,
                sessionId: result.sessionId,
                images: userMessageInput.attachedImages,
              })
            } catch (err) {
              logger?.warn(
                { sessionId: result.sessionId, error: String(err) },
                'failed to persist attached images',
              )
            }
          }
          for (const turnEvent of result.events) yield turnEvent
          break
        }

        case 'text-chunk': {
          // A SUBAGENT's stream never becomes main-transcript rows — it renders
          // nested under its spawning Agent card, and persists onto that card's
          // row (subagentNarrative) so the pane survives settle/reload.
          if (event.parentToolUseId !== undefined) {
            yield subagentActivity.onTextChunk(event.parentToolUseId, event.textDelta)
            break
          }
          const assistantMessage = ensureAssistantMessageRow(
            db,
            event.messageId,
            sessionId!,
            assistantMessageByMessageId,
            assistantAttribution,
          )
          chatRepository.appendToChatMessageBody(db, assistantMessage.id, event.textDelta)
          yield { kind: 'text-chunk', messageId: assistantMessage.id, textDelta: event.textDelta }
          if (event.isFinalChunk) {
            chatRepository.updateChatMessage(db, assistantMessage.id, { completedAt: new Date() })
          }
          break
        }

        case 'thinking-chunk': {
          // Subagent thinking is dropped — even nested it is noise at this
          // altitude; the agent's text + tool cards are the trace.
          if (event.parentToolUseId !== undefined) break
          const assistantMessage = ensureAssistantMessageRow(
            db,
            event.messageId,
            sessionId!,
            assistantMessageByMessageId,
            assistantAttribution,
          )
          // Provider's field is `textDelta`; chat-turn-event renames to `thinkingDelta`
          // for UI clarity (text vs thinking are distinct render surfaces).
          chatRepository.appendToChatMessageThinking(db, assistantMessage.id, event.textDelta)
          yield {
            kind: 'thinking-chunk',
            messageId: assistantMessage.id,
            thinkingDelta: event.textDelta,
          }
          break
        }

        case 'tool-use-started': {
          // A subagent's tool call: keyed to its Agent card, never a top-level
          // row (it used to flood the thread as the manager's own work) —
          // persisted lean on the Agent call's subagentToolCalls.
          if (event.parentToolUseId !== undefined) {
            yield subagentActivity.onToolStarted(event.parentToolUseId, {
              toolUseId: event.toolUseId,
              toolName: event.toolName,
              toolInput: event.toolInput,
              startedAt: event.startedAt,
            })
            break
          }
          const parentMessage = ensureAssistantMessageRow(
            db,
            event.parentMessageId,
            sessionId!,
            assistantMessageByMessageId,
            assistantAttribution,
          )
          const toolCall = chatRepository.insertChatToolCall(db, {
            id: crypto.randomUUID(),
            parentMessageId: parentMessage.id,
            toolUseId: event.toolUseId,
            toolName: event.toolName,
            toolInput: event.toolInput,
            toolOutput: null,
            status: 'started',
            // Non-null when the approval resolved before this row landed —
            // the decision was parked in the map.
            approvalStatus: approvalStatusByToolUseId.get(event.toolUseId) ?? null,
            isErrorResult: false,
            startedAt: event.startedAt,
            completedAt: null,
          })
          toolCallByToolUseId.set(event.toolUseId, toolCall.id)
          toolNameByToolUseId.set(event.toolUseId, event.toolName)
          yield { kind: 'tool-call-started', toolCall }
          break
        }

        case 'tool-use-completed': {
          if (event.parentToolUseId !== undefined) {
            yield subagentActivity.onToolCompleted(event.parentToolUseId, {
              toolUseId: event.toolUseId,
              toolOutput: event.output,
              isError: event.isError,
              completedAt: event.completedAt,
            })
            break
          }
          const dbId = toolCallByToolUseId.get(event.toolUseId)
          if (!dbId) {
            logger?.warn(
              { toolUseId: event.toolUseId },
              'tool-use-completed for unknown toolUseId — dropping',
            )
            break
          }
          // A completing Agent call settles its recorded entries: a clean return
          // means they only missed their completion events; an errored one
          // means the run died under them.
          subagentActivity.onParentSettled(event.toolUseId, {
            isError: event.isError,
            completedAt: event.completedAt,
          })
          // A denied tool's error tool_result is the DENIAL's echo, not a
          // failure — the row keeps 'denied' (the trust card must say the user
          // refused it, not that it broke).
          const wasDenied = approvalStatusByToolUseId.get(event.toolUseId) === 'denied'
          // A few tools' output must not outlive the turn — read_clipboard's
          // output IS the clipboard's plaintext, which is where a password
          // manager leaves things seconds earlier. The model still saw the real
          // value live; only the durable copy becomes a placeholder.
          const updated = chatRepository.updateChatToolCall(db, dbId, {
            toolOutput: toolOutputForStorage(
              toolNameByToolUseId.get(event.toolUseId) ?? '',
              event.output,
            ),
            status: wasDenied ? 'denied' : event.isError ? 'failed' : 'completed',
            isErrorResult: event.isError,
            completedAt: event.completedAt,
          })
          if (updated) yield { kind: 'tool-call-completed', toolCall: updated }
          break
        }

        case 'approval-requested': {
          yield await handleApprovalRequested({
            db,
            event,
            sessionId,
            userId,
            workspaceId,
            providerId,
            logger,
          })
          break
        }

        case 'approval-resolved': {
          // Stamp the decision on the tool-call row when the provider
          // correlates it (ApprovalDecision kinds map 1:1 onto ApprovalStatus).
          // A denial settles the row terminally — the tool never ran.
          if (event.toolUseId !== undefined) {
            approvalStatusByToolUseId.set(event.toolUseId, event.decision.kind)
            const dbId = toolCallByToolUseId.get(event.toolUseId)
            if (dbId !== undefined) {
              chatRepository.updateChatToolCall(db, dbId, {
                approvalStatus: event.decision.kind,
                ...(event.decision.kind === 'denied'
                  ? { status: 'denied', completedAt: event.resolvedAt }
                  : {}),
              })
            }
          }
          yield {
            kind: 'approval-resolved',
            approvalRequestId: event.approvalRequestId,
            decision: event.decision,
            resolvedAt: event.resolvedAt,
          }
          break
        }

        case 'usage-reported': {
          // Extracted to a sibling handler (file-size cap). `sessionModel` is loop
          // state, so it's threaded in + back out rather than closed over.
          const handled = handleUsageReported({
            db,
            event,
            sessionId,
            sessionModel,
            assistantMessageByMessageId,
          })
          sessionModel = handled.sessionModel
          yield handled.event
          break
        }

        case 'session-completed': {
          // Use the event's isNewSession (truth from the SDK) rather than the
          // closure variable — defensive against SDK-side state drift. The brain
          // keeps its fixed 'Global brain' title (skipAutoTitle).
          if (sessionId && event.isNewSession && !newSessionOptions?.skipAutoTitle) {
            const title = generateSessionTitle(db, sessionId)
            chatRepository.updateChatSession(db, sessionId, { title })
            yield { kind: 'session-titled', sessionId, title }
          }
          if (sessionId) yield { kind: 'session-completed', sessionId }
          break
        }

        case 'session-interrupted': {
          if (sessionId) yield { kind: 'session-interrupted', sessionId }
          break
        }

        case 'session-errored': {
          // Mark the last open assistant message as errored so the UI can
          // surface the partial text + the error context.
          const lastAssistantMessage = Array.from(assistantMessageByMessageId.values()).at(-1)
          if (lastAssistantMessage) {
            chatRepository.updateChatMessage(db, lastAssistantMessage.id, {
              errorCode: event.errorCode,
              errorMessage: event.errorMessage,
              completedAt: new Date(),
            })
          } else {
            // The turn died with ZERO assistant output (an API-overload retry
            // loop, a dead resume) — persist the failure as its own row, or
            // after a reload the thread shows an unanswered message forever.
            persistTurnFailureRow({
              db,
              sessionId: sessionId ?? input.resumeSessionId ?? null,
              errorCode: event.errorCode,
              errorMessage: event.errorMessage,
              erroredAt: event.erroredAt,
              ...(assistantAttribution !== undefined
                ? { attribution: assistantAttribution }
                : {}),
            })
          }
          // ALWAYS reaches the client — a failure before `session-started`
          // (spawn/auth/resume) used to be silently swallowed here, leaving the
          // composer "working" forever with the message unexplained. An empty
          // sessionId mirrors the provider's own pre-session error shape.
          yield {
            kind: 'session-errored',
            sessionId: sessionId ?? input.resumeSessionId ?? '',
            errorCode: event.errorCode,
            errorMessage: event.errorMessage,
            isRecoverable: event.isRecoverable,
          }
          break
        }
      }
    }
  } finally {
    // Teardown reap: a row still `started` here will never receive its
    // completion event — the stream ended, errored, was interrupted, or the
    // client abandoned iteration (an SSE disconnect `.return()`s this
    // generator). Settling to `cancelled` keeps cards from "running" forever;
    // this is the one home every turn runner flows through. Hard process
    // death (no finally runs at all) is covered by the boot reap in server.ts.
    // Best-effort: a reap failure while unwinding must not mask the error
    // that ended the turn.
    try {
      const cancelledRows = chatRepository.cancelStartedChatToolCalls(
        db,
        Array.from(toolCallByToolUseId.values()),
        new Date(),
      )
      if (cancelledRows.length > 0) {
        logger?.info(
          { sessionId, cancelledToolCallIds: cancelledRows.map((row) => row.id) },
          'turn teardown cancelled tool calls the stream left open',
        )
      }
    } catch (err) {
      logger?.error({ sessionId, error: String(err) }, 'turn teardown tool-call reap failed')
    }
  }
}

// `ensureAssistantMessageRow` extracted to its sibling file per Gate 3
// finding C4 (file-size cap). See `./ensure-assistant-message-row.ts`.
