// `recordLeafSession` — records the `chat_sessions` row for a LEAF agent session
// spawned by-reference (Slice 3a, addressable orchestration). A leaf is a normal
// RECORDED session (so the monitor / audit sees it) but `visibility:'hidden'` —
// it is never listed in the curated sidebar ("everything is recorded; the list is
// curated", `.claude/docs/agent-base/root-session-architecture.md §7`).
//
// The chat side of by-reference delegation: `chat` owns `chat_sessions`, so the
// INSERT lives here (orchestration never writes chat's tables — the apps/api
// composition `delegate-to-leaf-session.ts` calls this). Uses the SAME builder as
// a normal first turn + a swap segment (`buildNewChatSessionRow`) so the three
// never drift; sibling of `recordSwapSegmentSession`. Co-commits the
// `chat.session-created` outbox event so the activity log / monitor sees the leaf.
//
// The leaf's messages are NOT persisted to `chat_messages` in Slice 3a (the
// synchronous result is returned from the create drain); full leaf-transcript
// persistence is a documented follow-up (build brief Slice 3a).

import { withTransaction, type Database } from '@vynel/db'
import * as chatRepository from '../repositories/index.js'
import type { ChatSession } from '../repositories/index.js'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import type { AiAgentProviderId } from '@vynel/providers'
import { CHAT_SESSION_CREATED, type ChatSessionCreatedPayload } from '../chat-events.js'
import { buildNewChatSessionRow } from '../turn-consumption/build-new-chat-session-row.js'

export type RecordLeafSessionInput = {
  /** The leaf's SDK session id — the recorded segment's PK (D15). */
  sessionId: string
  userId: string
  workspaceId: string
  providerId: AiAgentProviderId
  /** The delegated agent's slug — seeds an honest leaf title. */
  agentSlug: string
  /** When the leaf started. Defaults to now. */
  startedAt?: Date
}

export function recordLeafSession(db: Database, input: RecordLeafSessionInput): ChatSession {
  const startedAt = input.startedAt ?? new Date()
  const payload: ChatSessionCreatedPayload = {
    userId: input.userId,
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    providerId: input.providerId,
  }

  return withTransaction(db, (tx) => {
    const leaf = chatRepository.insertChatSession(
      tx,
      buildNewChatSessionRow({
        sessionId: input.sessionId,
        userId: input.userId,
        workspaceId: input.workspaceId,
        providerId: input.providerId,
        startedAt,
        title: `Agent: ${input.agentSlug}`,
        initialMessageCount: 0,
        // Recorded but hidden from the curated sidebar — a leaf "hand", not a
        // user conversation. The monitor (Slice 5) surfaces it in the tree.
        visibility: 'hidden',
        // A delegated agent session — not the user's workspace conversation
        // (it runs in a workspace, so the default would mis-derive 'workspace').
        scope: 'agent',
      }),
    )
    insertOutboxEvent(tx, {
      id: crypto.randomUUID(),
      type: CHAT_SESSION_CREATED,
      payload,
      createdAt: new Date(),
      processedAt: null,
    })
    return leaf
  })
}
