// `recordDirectReplyMessage` — persists a colleague's @mention reply DIRECTLY
// onto the requester thread's transcript (live-tracking redesign, the
// direct-reply tweak): the user addressed the colleague, so its reply is a
// message TO THE USER. It lands as the colleague speaking (the report/update
// box — role 'user' + sourceKind 'agent', the inbound-report shape) WITHOUT a
// notify turn, so nothing re-narrates it; the requester absorbs it silently on
// its next turn via the catch-up net. That dependence is why the GLOBAL root
// is the ONLY caller: the VOICE thread has no catch-up net, so a voice-asked
// direct reply deliberately never routes here — it runs a notify turn under
// the DIRECT steer instead (voice-requester routing; the tick's
// `isGlobalRequester` gate is the enforcement). Same FK-id-gate as the old
// push recorder: a reply never mints a requester session.

import { randomUUID } from 'node:crypto'
import { withTransaction, type Database } from '@vynel/db'
import * as chatRepository from '../repositories/index.js'

export type RecordDirectReplyMessageInput = {
  /** The requester thread's CURRENT SDK session id (re-resolved at delivery
   *  time) — in practice always the global root's head; see the header for
   *  why a voice head must never be passed. */
  targetSessionId: string
  /** The marker-prefixed body (the report/update message marker + the reply) —
   *  the marker keeps model-facing attribution; the box strips it for display
   *  and reads the update-vs-report kind from it. */
  body: string
  /** The colleague's display label — the box's author line. */
  sourceLabel: string
  /** The task chain key — the pointer/settle machinery's correlation. */
  threadId?: string
  /** The delivery hop's trace key. */
  partialSessionId?: string
}

/** Persist one direct colleague reply onto the requester's session. Returns
 *  false (no insert) when that session row is missing — the caller falls back
 *  to the notify machinery, which handles the no-session shapes. */
export function recordDirectReplyMessage(
  db: Database,
  input: RecordDirectReplyMessageInput,
): boolean {
  if (chatRepository.findChatSessionById(db, input.targetSessionId) === null) {
    return false
  }
  const now = new Date()
  withTransaction(db, (tx) => {
    chatRepository.insertChatMessage(tx, {
      id: randomUUID(),
      sessionId: input.targetSessionId,
      role: 'user',
      body: input.body,
      sourceKind: 'agent',
      sourceLabel: input.sourceLabel,
      threadId: input.threadId ?? null,
      partialSessionId: input.partialSessionId ?? null,
      originChannel: null,
      thinkingBody: null,
      inputTokens: null,
      outputTokens: null,
      attachedImagesMetadata: null,
      errorCode: null,
      errorMessage: null,
      startedAt: now,
      completedAt: now,
      createdAt: now,
    })
    chatRepository.updateChatSession(tx, input.targetSessionId, { lastMessageAt: now })
  })
  return true
}
