// `recordSystemNoteMessage` — persists a SYSTEM-authored note onto a session's
// transcript: the anchor-shaped row (role 'user', sourceKind 'global-root', no
// label) that continuity writes when a pending checkpoint is dropped ("Not
// continued — the next step was: …"), or — with a `sourceLabel` — the
// ATTRIBUTED quiet notice a producer signs (sourceKind 'system' +
// "Schedule · Tea"), which is how a fired schedule already presents itself.
// Lives beside the other system-authored
// row writers (`record-direct-reply-message`, `record-pushed-report-message`)
// so `packages/chat/src/records/` stays the ONE home for rows no human typed
// (session-hardening G-8) — the session package composes the wording and
// decides WHEN; the row shape lives here.
import { randomUUID } from 'node:crypto'
import type { Database } from '@vynel/db'
import * as chatRepository from '../repositories/index.js'

export type RecordSystemNoteMessageInput = {
  /** The session the note lands on (the identity's current head). */
  sessionId: string
  /** The finished note text — composed by the caller. */
  body: string
  /** An ATTRIBUTED note ("Schedule · Tea"): the row wears sourceKind 'system'
   *  + this label, the same shape a fired global schedule's inbound row wears,
   *  so the transcript names who spoke without touching the body. Omitted =
   *  continuity's anonymous note (sourceKind 'global-root', no label). */
  sourceLabel?: string
  /** The row's clock — injectable for deterministic tests. */
  now?: Date
}

/** Persist one system-authored note row (+ the session's lastMessageAt bump).
 *  Returns false (no insert) when the session row is missing — the caller's
 *  log line is then the only trace. Runs inside whatever transaction `db` is. */
export function recordSystemNoteMessage(db: Database, input: RecordSystemNoteMessageInput): boolean {
  if (chatRepository.findChatSessionById(db, input.sessionId) === null) return false
  const now = input.now ?? new Date()
  chatRepository.insertChatMessage(db, {
    id: randomUUID(),
    sessionId: input.sessionId,
    role: 'user',
    body: input.body,
    sourceKind: input.sourceLabel === undefined ? 'global-root' : 'system',
    sourceLabel: input.sourceLabel ?? null,
    partialSessionId: null,
    threadId: null,
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
  chatRepository.updateChatSession(db, input.sessionId, { lastMessageAt: now })
  return true
}
