// Reconstruct the GLOBAL root's full conversation history — the messages across its
// swap-segment chain — for cold-start hydration (P0.1: the global-chat home shows
// history on reload, not just the in-memory live turn). Composed at the api layer
// from the primary resolver (session continuity), the swap-chain reconstruction
// (inlined below — the monitor package has not been pulled into KLONE yet), and the
// chat message reads — so no core domain takes a new cross-domain dependency (the
// api already orchestrates reads like this).
//
// The segment chain is derived from the ROWS themselves (`continuedFromSessionId`,
// walked back from the current session) — every swap writer stamps the link, so
// the chain needs no outbox event and has no event-window cap (session-review B4:
// the previous event-derived read silently truncated once the first swap aged out
// of the window, and mid-turn provider swaps never emitted an event at all —
// reload then showed only post-swap rows).
//
// Returns a LEAN, attributed DTO (not the raw chat_messages row): the transcript UI
// needs only id + role + body + the brain-tree source identity + the user row's
// attachment references. Keeping the row shape out of the API boundary avoids
// leaking the full schema (tokens, timestamps) over the wire.

import { findPrimaryConversation } from '../continuity/index.js'
import {
  findChatSessionById,
  listRecentChatMessagesForSession,
  listChatToolCallsForSession,
} from '@vynel/chat/repositories'
import type {
  ChatMessage,
  ChatMessageRole,
  ChatMessageSourceKind,
  ChatMessageOriginChannel,
  ChatToolCall,
  AttachedImageMetadata,
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
  /** The delegation CHAIN key (persona-sessions) — the settle-match key. */
  threadId: string | null
  /** The inbound channel a USER row arrived through ("via Voice"); null = composer. */
  originChannel: ChatMessageOriginChannel | null
  /** Attachment references on a USER row (filename/mimeType/sizeBytes) — the
   *  transcript renders their chips on reload; null = no attachments. */
  attachedImagesMetadata: AttachedImageMetadata[] | null
}

function toTranscriptMessage(message: ChatMessage): GlobalRootTranscriptMessage {
  return {
    id: message.id,
    role: message.role,
    body: message.body,
    sourceKind: message.sourceKind,
    sourceLabel: message.sourceLabel,
    partialSessionId: message.partialSessionId,
    threadId: message.threadId,
    originChannel: message.originChannel,
    attachedImagesMetadata: message.attachedImagesMetadata,
  }
}

// Defensive cap on the backward segment walk — matches the transcript's own
// message cap in spirit (a chain past this depth predates any readable window).
const MAX_SEGMENT_WALK = 200

// Derives the primary's ordered SDK-session segment chain by walking each
// segment row's `continuedFromSessionId` back from the CURRENT session. Every
// swap writer stamps the link — the boundary bridge via
// `recordSwapSegmentSession`, a mid-turn provider swap via
// `handleSessionStarted`'s missing-row branch (session-review B4) — so the rows
// carry the chain themselves: no outbox dependency, no event-window truncation,
// and mid-turn swaps (which never emitted an event) are covered. Cycle-safe: a
// corrupt self/loop link stops the walk (first visit wins). Oldest → newest,
// current segment always included. Legacy rows written before the link column
// stop the walk early — same visible truncation the event window had, healing
// forward as new segments stamp their predecessor.
function reconstructPrimaryThread(
  db: Database,
  input: { currentSdkSessionId: string; userId: string },
): string[] {
  // The head comes from the user's own tenant-checked primary — it enters the
  // chain unconditionally. Every FOLLOWED link must prove ownership BEFORE its
  // id enters the chain: a corrupt or foreign link ends the walk, and a foreign
  // segment can never leak into the message read below.
  const chain: string[] = [input.currentSdkSessionId]
  const visited = new Set<string>([input.currentSdkSessionId])
  let row = findChatSessionById(db, input.currentSdkSessionId)
  while (chain.length < MAX_SEGMENT_WALK) {
    const next = row !== null && row.userId === input.userId ? row.continuedFromSessionId : null
    if (next === null || visited.has(next)) break
    const nextRow = findChatSessionById(db, next)
    if (nextRow === null || nextRow.userId !== input.userId) break
    visited.add(next)
    chain.push(next)
    row = nextRow
  }
  return chain.reverse()
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

  const sessionIds = root.currentSdkSessionId
    ? reconstructPrimaryThread(db, { currentSdkSessionId: root.currentSdkSessionId, userId })
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
