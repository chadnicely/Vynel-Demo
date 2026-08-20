// `recordNoteOnPrimaryHead` — the ONE way continuity puts a visible note on a
// continuing identity's thread. The row shape lives in `packages/chat`'s
// records (session-hardening G-8, `recordSystemNoteMessage`); this resolves
// WHICH session it lands on: the identity's current head.
//
// The head may not exist yet (an identity that never linked a segment) or may
// be gone (a purged segment) — then there is no thread to write on and the
// caller's log line is the only trace, so this answers false rather than
// throwing. Runs inside whatever transaction `db` is.
//
// LATEST-ROW DEDUPE (`onlyIfNotLatest`): the boot survivor pass runs on every
// start and the survivor it announces stays on the row until a turn consumes
// it — three restarts before the user says anything must not stack three
// identical notes.

import type { Database } from '@vynel/db'
import { recordSystemNoteMessage } from '@vynel/chat'
import { listRecentChatMessagesForSession } from '@vynel/chat/repositories'
import * as primarySessionsRepository from '../repositories/index.js'

export type RecordNoteOnPrimaryHeadInput = {
  primarySessionId: string
  /** The finished note text — composed by the caller. */
  body: string
  /** Skip the write when the head's newest row already says exactly this. */
  onlyIfNotLatest?: boolean
  now?: Date
}

/** Persist one system-authored note on the identity's head. False when there
 *  was no head to write on, or when the dedupe guard skipped it. */
export function recordNoteOnPrimaryHead(
  db: Database,
  input: RecordNoteOnPrimaryHeadInput,
): boolean {
  const primary = primarySessionsRepository.findPrimarySessionById(db, input.primarySessionId)
  const headSessionId = primary?.currentSdkSessionId ?? null
  if (headSessionId === null) return false
  if (input.onlyIfNotLatest === true && latestBodyOf(db, headSessionId) === input.body) return false
  return recordSystemNoteMessage(db, {
    sessionId: headSessionId,
    body: input.body,
    now: input.now ?? new Date(),
  })
}

function latestBodyOf(db: Database, sessionId: string): string | null {
  const [latest] = listRecentChatMessagesForSession(db, sessionId, 1)
  return latest?.body ?? null
}
