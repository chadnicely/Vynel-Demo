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
import type { Database } from '@vynel/db'
import type { ChatMessage, AttachedImageMetadata } from '../repositories/index.js'
import type { AiAgentProviderId, NormalizedSessionEvent } from '@vynel/providers'
import { generateSessionTitle } from './generate-session-title.js'
import { ensureAssistantMessageRow } from './ensure-assistant-message-row.js'
import { handleSessionStarted } from './handle-session-started.js'
import { handleApprovalRequested } from './handle-approval-requested.js'
import { handleUsageReported } from './handle-usage-reported.js'
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
  /** Presentation overrides for the new-session row (the brain passes hidden +
   *  'Global brain' + skipAutoTitle). Omitted by the workspace path → defaults. */
  newSessionOptions?: NewSessionOptions
  logger?: StructuralLogger
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
    logger,
  } = input

  let sessionId: string | null = null
  let userMessage: ChatMessage | null = null
  // The model the session ran with — reported on every assistant message;
  // persisted once on the session (the UI context-window denominator).
  let sessionModel: string | null = null
  // Per-turn caches (coding §1.4) — fresh per call; GC'd when generator exits.
  const assistantMessageByMessageId = new Map<string, ChatMessage>()
  const toolCallByToolUseId = new Map<string, string /* dbId */>()

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
          ...(newSessionOptions !== undefined ? { newSessionOptions } : {}),
        })
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
        const assistantMessage = ensureAssistantMessageRow(
          db,
          event.messageId,
          sessionId!,
          assistantMessageByMessageId,
        )
        chatRepository.appendToChatMessageBody(db, assistantMessage.id, event.textDelta)
        yield { kind: 'text-chunk', messageId: assistantMessage.id, textDelta: event.textDelta }
        if (event.isFinalChunk) {
          chatRepository.updateChatMessage(db, assistantMessage.id, { completedAt: new Date() })
        }
        break
      }

      case 'thinking-chunk': {
        const assistantMessage = ensureAssistantMessageRow(
          db,
          event.messageId,
          sessionId!,
          assistantMessageByMessageId,
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
        const parentMessage = ensureAssistantMessageRow(
          db,
          event.parentMessageId,
          sessionId!,
          assistantMessageByMessageId,
        )
        const toolCall = chatRepository.insertChatToolCall(db, {
          id: crypto.randomUUID(),
          parentMessageId: parentMessage.id,
          toolUseId: event.toolUseId,
          toolName: event.toolName,
          toolInput: event.toolInput,
          toolOutput: null,
          status: 'started',
          approvalStatus: null,
          isErrorResult: false,
          startedAt: event.startedAt,
          completedAt: null,
        })
        toolCallByToolUseId.set(event.toolUseId, toolCall.id)
        yield { kind: 'tool-call-started', toolCall }
        break
      }

      case 'tool-use-completed': {
        const dbId = toolCallByToolUseId.get(event.toolUseId)
        if (!dbId) {
          logger?.warn(
            { toolUseId: event.toolUseId },
            'tool-use-completed for unknown toolUseId — dropping',
          )
          break
        }
        const updated = chatRepository.updateChatToolCall(db, dbId, {
          toolOutput: event.output,
          status: event.isError ? 'failed' : 'completed',
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
        }
        if (sessionId) {
          yield {
            kind: 'session-errored',
            sessionId,
            errorCode: event.errorCode,
            errorMessage: event.errorMessage,
            isRecoverable: event.isRecoverable,
          }
        }
        break
      }
    }
  }
}

// `ensureAssistantMessageRow` extracted to its sibling file per Gate 3
// finding C4 (file-size cap). See `./ensure-assistant-message-row.ts`.
