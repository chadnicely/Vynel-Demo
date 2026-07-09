// Reconstruct the GLOBAL root's full conversation history — the messages across its
// swap-segment chain — for cold-start hydration (P0.1: the global-chat home shows
// history on reload, not just the in-memory live turn). Composed at the api layer
// from the primary resolver (session continuity), the swap-chain reconstruction
// (inlined below — the monitor package has not been pulled into KLONE yet), and the
// chat message reads — so no core domain takes a new cross-domain dependency (the
// api already orchestrates reads like this).
//
// The swap chain is empty until the root first swaps (its current session is then
// the whole thread); once it has swapped, the chain already ends with the current
// session — so the union below covers both.
//
// Returns a LEAN, attributed DTO (not the raw chat_messages row): the transcript UI
// needs only id + role + body + the brain-tree source identity. Keeping the row
// shape out of the API boundary avoids leaking the full schema (tokens, timestamps,
// image metadata) over the wire.

import {
  findPrimaryConversation,
  SESSION_SWAPPED_EVENT_TYPE,
  type SessionSwappedEventPayload,
} from '@vynel/session/continuity'
import { listRecentOutboxEventsByTypes } from '@vynel/db/repositories/_shared'
import {
  listRecentChatMessagesForSession,
  listChatToolCallsForSession,
} from '@vynel/chat/repositories'
import type {
  ChatMessage,
  ChatMessageRole,
  ChatMessageSourceKind,
  ChatMessageOriginChannel,
  ChatToolCall,
} from '@vynel/chat/repositories'
import type { Database } from '@vynel/db'

// Defensive cap on the hydration read — the global root is one ever-growing thread,
// so the transcript is a growth-scaling list (D16: cap in Phase 1, keyset cursor
// defers to 1.5). 200 is a generous cold-start window (well past a normal thread);
// older history loads when paging lands.
const MAX_TRANSCRIPT_MESSAGES = 200

export type GlobalRootTranscriptMessage = {
  id: string
  role: ChatMessageRole
  body: string
  /** Brain-tree attribution — null on rows persisted before P0.1; else the origin. */
  sourceKind: ChatMessageSourceKind | null
  /** The workspace / agent name for 'workspace-manager' / 'agent' rows. */
  sourceLabel: string | null
  /** Brain-tree Chapter 3 — the delegation request's correlation key on a bubbled-up
   *  report row; lets the /global bubble open its condensed trace. Null on ordinary rows. */
  partialSessionId: string | null
  /** The inbound channel a USER row arrived through ("via Voice"); null = composer. */
  originChannel: ChatMessageOriginChannel | null
}

function toTranscriptMessage(message: ChatMessage): GlobalRootTranscriptMessage {
  return {
    id: message.id,
    role: message.role,
    body: message.body,
    sourceKind: message.sourceKind,
    sourceLabel: message.sourceLabel,
    partialSessionId: message.partialSessionId,
    originChannel: message.originChannel,
  }
}

// Derives the primary's ordered SDK-session segment chain from its `session.swapped`
// events, so the transcript can stitch the FULL cross-reload history WITHOUT a
// primary-session column on `chat_sessions` (D15 + no-chat-rewrite preserved).
// Chain order: the first swap's `fromSdkSessionId` is the original segment; each
// subsequent `toSdkSessionId` (oldest→newest) is the next. Empty if the primary
// never swapped (its current session is the whole thread). Faithful port of the
// source monitor's `reconstructRootThread` (payload key renamed root→primary);
// moves to the monitor package when that module is pulled.
function reconstructPrimaryThread(
  db: Database,
  input: { primarySessionId: string; userId: string },
): string[] {
  const swaps = listRecentOutboxEventsByTypes(db, {
    types: [SESSION_SWAPPED_EVENT_TYPE],
    limit: 200,
  })
    .map((row) => row.payload as unknown as SessionSwappedEventPayload)
    .filter((p) => p.primarySessionId === input.primarySessionId && p.userId === input.userId)
    // listRecent returns newest-first; order the chain oldest→newest.
    .sort((a, b) => a.swappedAt.localeCompare(b.swappedAt))

  if (swaps.length === 0) return []

  const chain: string[] = [swaps[0]!.fromSdkSessionId]
  for (const swap of swaps) chain.push(swap.toSdkSessionId)
  return chain
}

export type GlobalRootTranscript = {
  messages: GlobalRootTranscriptMessage[]
  /** Tool calls keyed by the assistant message they belong to (parentMessageId) —
   *  mirrors the workspace `GET /sessions/{id}`. The brain persists tool calls now
   *  (session unification), so the transcript carries them; the brain chat renders
   *  them on reload via the same `ToolCallCard` the workspace + the live turn use. */
  toolCallsByMessageId: Record<string, ChatToolCall[]>
}

export function resolveGlobalRootTranscript(
  db: Database,
  userId: string,
  limit: number = MAX_TRANSCRIPT_MESSAGES,
): GlobalRootTranscript {
  // workspaceId omitted → the global primary.
  const root = findPrimaryConversation(db, { userId })
  if (!root) return { messages: [], toolCallsByMessageId: {} }

  const segments = reconstructPrimaryThread(db, { primarySessionId: root.id, userId })
  const sessionIds =
    segments.length > 0
      ? segments
      : root.currentSdkSessionId
        ? [root.currentSdkSessionId]
        : []

  // Walk segments newest-first, pulling each segment's latest messages until the
  // cap is filled — bounds the DB read AND the response. unshift keeps the result
  // chronological (older segments prepend before newer ones). Tool calls for each
  // walked segment are grouped by parentMessageId (mirrors get-chat-session-detail).
  const messages: GlobalRootTranscriptMessage[] = []
  const toolCallsByMessageId: Record<string, ChatToolCall[]> = {}
  for (let index = sessionIds.length - 1; index >= 0 && messages.length < limit; index--) {
    const remaining = limit - messages.length
    const recent = listRecentChatMessagesForSession(db, sessionIds[index]!, remaining)
    messages.unshift(...recent.map(toTranscriptMessage))
    for (const toolCall of listChatToolCallsForSession(db, sessionIds[index]!)) {
      if (!toolCallsByMessageId[toolCall.parentMessageId]) {
        toolCallsByMessageId[toolCall.parentMessageId] = []
      }
      toolCallsByMessageId[toolCall.parentMessageId]!.push(toolCall)
    }
  }
  return { messages, toolCallsByMessageId }
}
