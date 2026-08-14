// Reconstruct a primary conversation's full history — the messages across its
// swap-segment chain — for the continuing-thread views (the global brain AND
// each workspace's main chat). One resolver for every scope: the tester-DB
// incident (2026-08-14) showed the workspace thread binding to the CURRENT
// segment only, so a context-pressure swap emptied the visible conversation
// while all pre-swap rows sat one chain-link away. The chain walk that fixed
// this for the global root (session-review B4) now serves both scopes.
//
// The segment chain is derived from the ROWS themselves (`continuedFromSessionId`,
// walked back from the current session) — every swap writer stamps the link, so
// the chain needs no outbox event and has no event-window cap (session-review B4:
// the previous event-derived read silently truncated once the first swap aged out
// of the window, and mid-turn provider swaps never emitted an event at all —
// reload then showed only post-swap rows).
//
// Returns the session-detail envelope (`session` + full message rows + tool
// calls keyed by parent message) — the SAME shape `getChatSessionDetail`
// serves — so the continuing views render through the exact pipeline the
// single-session reads use. `session` is the CURRENT segment's row (the meter's
// model source); null when the scope has no continuing conversation yet.

import { findPrimaryConversation } from '../continuity/index.js'
import {
  findChatSessionById,
  listRecentChatMessagesForSession,
  listChatToolCallsForSession,
} from '@vynel/chat/repositories'
import type { ChatSession, ChatMessage, ChatToolCall } from '@vynel/chat/repositories'
import { NotFoundError } from '@vynel/errors'
import type { Database } from '@vynel/db'

// Defensive cap on the hydration read — a primary is one ever-growing thread,
// so the transcript is a growth-scaling list (D16: cap in Phase 1, keyset cursor
// defers to 1.5). 200 is a generous cold-start window (well past a normal thread);
// older history loads when paging lands.
const MAX_TRANSCRIPT_MESSAGES = 200

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

export type PrimaryTranscript = {
  /** The CURRENT segment's row (model / meter denominator). Null when the
   *  scope has no continuing conversation yet (or its segment row is gone). */
  session: ChatSession | null
  /** Chronological across ALL chain segments, capped to the newest window. */
  messages: ChatMessage[]
  /** Tool calls keyed by the assistant message they belong to (parentMessageId) —
   *  mirrors `getChatSessionDetail`, so the thread renders them via the same
   *  `ToolCallCard` on reload. */
  toolCallsByMessageId: Record<string, ChatToolCall[]>
}

export type ResolvePrimaryTranscriptInput = {
  userId: string
  /** Omit for the global root; set for one workspace's continuing primary. */
  workspaceId?: string
  limit?: number
}

export function resolvePrimaryTranscript(
  db: Database,
  input: ResolvePrimaryTranscriptInput,
): PrimaryTranscript {
  const limit = input.limit ?? MAX_TRANSCRIPT_MESSAGES
  const primary = findPrimaryConversation(db, {
    userId: input.userId,
    ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
  })
  if (!primary || primary.currentSdkSessionId === null) {
    return { session: null, messages: [], toolCallsByMessageId: {} }
  }

  const headRow = findChatSessionById(db, primary.currentSdkSessionId)
  const session = headRow !== null && headRow.userId === input.userId ? headRow : null
  const sessionIds = reconstructPrimaryThread(db, {
    currentSdkSessionId: primary.currentSdkSessionId,
    userId: input.userId,
  })
  const pulled = pullChainMessages(db, sessionIds, limit)
  return { session, ...pulled }
}

export type SessionChainTranscript = {
  /** The chain's head segment — the row the caller opened. Never null: an
   *  unknown / foreign / deleted head throws instead (no enumeration leak). */
  session: ChatSession
  messages: ChatMessage[]
  toolCallsByMessageId: Record<string, ChatToolCall[]>
}

export type ResolveSessionChainTranscriptInput = {
  userId: string
  /** The chain's newest segment (the sessions overview keys every folded
   *  chain by it). A chainless session is a one-segment chain — same read. */
  headSessionId: string
  limit?: number
}

// The panel-side sibling of `resolvePrimaryTranscript`: the same chain walk,
// started from an arbitrary OWNED head instead of a scope's primary — the
// Sessions list opens a folded chain by its newest segment, and a spawned
// session's compaction swap must not empty that view either (the same
// single-segment shape the continuing threads had). Owner-gated exactly like
// `getChatSessionDetail`: missing, foreign, and soft-deleted heads all throw
// the same NotFound.
export function resolveSessionChainTranscript(
  db: Database,
  input: ResolveSessionChainTranscriptInput,
): SessionChainTranscript {
  const session = findChatSessionById(db, input.headSessionId)
  if (!session || session.deletedAt || session.userId !== input.userId) {
    throw new NotFoundError('chat-session', input.headSessionId)
  }
  const sessionIds = reconstructPrimaryThread(db, {
    currentSdkSessionId: input.headSessionId,
    userId: input.userId,
  })
  const pulled = pullChainMessages(db, sessionIds, input.limit ?? MAX_TRANSCRIPT_MESSAGES)
  return { session, ...pulled }
}

// Walk segments newest-first, pulling each segment's latest messages until the
// cap is filled — bounds the DB read AND the response. unshift keeps the result
// chronological (older segments prepend before newer ones). Tool calls for each
// walked segment are grouped by parentMessageId (mirrors get-chat-session-detail).
function pullChainMessages(
  db: Database,
  sessionIds: string[],
  limit: number,
): { messages: ChatMessage[]; toolCallsByMessageId: Record<string, ChatToolCall[]> } {
  const messages: ChatMessage[] = []
  const toolCallsByMessageId: Record<string, ChatToolCall[]> = {}
  for (let index = sessionIds.length - 1; index >= 0 && messages.length < limit; index--) {
    const remaining = limit - messages.length
    const recent = listRecentChatMessagesForSession(db, sessionIds[index]!, remaining)
    messages.unshift(...recent)
    for (const toolCall of listChatToolCallsForSession(db, sessionIds[index]!)) {
      if (!toolCallsByMessageId[toolCall.parentMessageId]) {
        toolCallsByMessageId[toolCall.parentMessageId] = []
      }
      toolCallsByMessageId[toolCall.parentMessageId]!.push(toolCall)
    }
  }
  return { messages, toolCallsByMessageId }
}
