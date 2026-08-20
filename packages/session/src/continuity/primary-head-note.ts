// `recordNoteOnPrimaryHead` — the ONE way continuity puts a visible note on a
// continuing identity's thread. The row shape lives in `packages/chat`'s
// records (session-hardening G-8, `recordSystemNoteMessage`); this resolves
// WHICH session it lands on: the identity's current head.
//
// The head may not exist yet (an identity that never linked a segment) or may
// be gone (a purged segment) — then there is no thread to write on and the
// caller's log line is the only trace, so this answers `'no-thread'` rather
// than throwing. Runs inside whatever transaction `db` is.
//
// THREE outcomes, not a boolean: "nothing was written" splits into a missing
// thread (worth a log line — the note is lost) and the dedupe below (worth
// nothing — the note is already there). A caller collapsing them warned "no
// thread" on every idempotent restart.
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

export type RecordNoteOnPrimaryHeadOutcome =
  /** The note is on the thread. */
  | 'written'
  /** No thread to write on — the identity never linked a segment, or its head
   *  was purged. The note is lost; the caller's log line is the only trace. */
  | 'no-thread'
  /** The dedupe guard: the head's newest row already says exactly this. */
  | 'already-latest'

/** Persist one system-authored note on the identity's head. */
export function recordNoteOnPrimaryHead(
  db: Database,
  input: RecordNoteOnPrimaryHeadInput,
): RecordNoteOnPrimaryHeadOutcome {
  const primary = primarySessionsRepository.findPrimarySessionById(db, input.primarySessionId)
  const headSessionId = primary?.currentSdkSessionId ?? null
  if (headSessionId === null) return 'no-thread'
  if (input.onlyIfNotLatest === true && latestBodyOf(db, headSessionId) === input.body) {
    return 'already-latest'
  }
  // False here means the head id points at a segment that is gone — still no
  // thread, just discovered one level down.
  return recordSystemNoteMessage(db, {
    sessionId: headSessionId,
    body: input.body,
    now: input.now ?? new Date(),
  })
    ? 'written'
    : 'no-thread'
}

function latestBodyOf(db: Database, sessionId: string): string | null {
  const [latest] = listRecentChatMessagesForSession(db, sessionId, 1)
  return latest?.body ?? null
}
