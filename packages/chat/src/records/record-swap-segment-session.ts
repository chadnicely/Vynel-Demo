// `recordSwapSegmentSession` — records the `chat_sessions` row for a fresh SDK
// session minted by a session-continuity SWAP (root-as-thread, Slice 1). When
// the root nears its context limit it seed-fresh-swaps to a brand-new SDK
// session; that session is a normal RECORDED segment — listed in the sidebar
// and browsable like any conversation — so it needs a `chat_sessions` row even
// though it was not born from a user-initiated turn.
//
// This is the chat side of the swap: `chat` owns `chat_sessions`, so the INSERT
// lives here (apps/api orchestrates; `session-continuity` only repoints the
// root + records the supersession chain — it never writes chat's tables). The
// row uses the SAME builder as a normal first turn (`buildNewChatSessionRow`)
// so the two never drift. The segment starts empty (0 messages) — the priming
// exchange that mints the SDK id is NOT persisted to Vynel's `chat_messages`
// (it lives only in the runtime's own session storage, where the next resumed
// turn reads it as carried context). The next real user turn populates the
// segment via the normal resumed-turn flow.
//
// Co-commits a `chat.session-created` outbox event (same as a normal new
// session) so the activity log / future monitor sees every recorded segment —
// "everything is recorded; the list is curated"
// (`.claude/docs/agent-base/root-session-architecture.md §7`).
//
// Spec: build brief Slice 1 §2.2 (resolves session-continuity Open #5 — the
// root ↔ chat-session linkage).

import { withTransaction, type Database } from '@vynel/db'
import * as chatRepository from '../repositories/index.js'
import type { ChatSession } from '../repositories/index.js'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import type { AiAgentProviderId } from '@vynel/providers'
import { CHAT_SESSION_CREATED, type ChatSessionCreatedPayload } from '../chat-events.js'
import { buildNewChatSessionRow } from '../turn-consumption/build-new-chat-session-row.js'

export type RecordSwapSegmentSessionInput = {
  /** The fresh SDK session id the swap minted — the recorded segment's PK. */
  sessionId: string
  userId: string
  workspaceId: string
  providerId: AiAgentProviderId
  /** When the segment was started. Defaults to now. */
  startedAt?: Date
}

// A swap segment continues an existing thread rather than starting a new topic,
// so it carries an honest default title instead of the first-turn placeholder.
// It is resumed (not new) on its next turn, so the title is never auto-derived
// — titling refinement is deferred (build brief Slice 1 is invisible-by-design).
const SWAP_SEGMENT_TITLE = 'Continued conversation'

export function recordSwapSegmentSession(
  db: Database,
  input: RecordSwapSegmentSessionInput,
): ChatSession {
  const startedAt = input.startedAt ?? new Date()
  const payload: ChatSessionCreatedPayload = {
    userId: input.userId,
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    providerId: input.providerId,
  }

  return withTransaction(db, (tx) => {
    const segment = chatRepository.insertChatSession(
      tx,
      buildNewChatSessionRow({
        sessionId: input.sessionId,
        userId: input.userId,
        workspaceId: input.workspaceId,
        providerId: input.providerId,
        startedAt,
        title: SWAP_SEGMENT_TITLE,
        initialMessageCount: 0,
        // Hidden from the curated sidebar — the continuing brain shows as one
        // entry, not a growing chain of "Continued conversation" rows (Slice 2).
        visibility: 'hidden',
      }),
    )
    insertOutboxEvent(tx, {
      id: crypto.randomUUID(),
      type: CHAT_SESSION_CREATED,
      payload,
      createdAt: new Date(),
      processedAt: null,
    })
    return segment
  })
}
