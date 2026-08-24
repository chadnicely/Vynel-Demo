// `linkPrimaryToTurnSegment` — the FIRST-TURN bookkeeping every primary needs
// the moment its segment is known: point the primary at the SDK session the
// turn runs on, and hide a manager primary's first segment (a workspace brain,
// the global root, the voice twin — their continuing thread shows as ONE
// pinned entry, never as a listed "New session" row). A spawned session's or
// colleague's first segment stays listed: it IS the identity's row.
//
// ONE op, TWO callers: the boundary wrapper runs it IN-STREAM at
// `session-created`, and `prepareTurnContinuity` runs it again after the
// drain. Idempotent, so the second run is a no-op. In-stream is what makes a
// room survive a process death mid-first-turn (2026-08-25): the link used to
// be post-turn only, so a killed engine — a crash, a dev restart — left a
// 24-message conversation with no primary pointing at it and the room showing
// its welcome hero over a stranded, still-listed thread.

import type { Database } from '@vynel/db'
import { NotFoundError } from '@vynel/errors'
import { updateChatSession } from '@vynel/chat/repositories'
import * as primarySessionsRepository from '../repositories/index.js'
import type { PrimarySessionScope } from '../repositories/index.js'
import { linkPrimarySessionToSdkSession } from './link-primary-session-to-sdk-session.js'

export type LinkPrimaryToTurnSegmentInput = {
  primarySessionId: string
  userId: string
  /** What the primary pointed at BEFORE this turn — null on its first turn. */
  priorSdkSessionId: string | null
  /** The SDK session the turn runs on (resumed id, or the fresh id). */
  sdkSessionId: string
}

/** A MANAGER primary's first segment is the continuing thread itself and
 *  hides; a spawned session's or colleague's first segment is its listed row. */
export function hidesFirstSegment(scope: PrimarySessionScope): boolean {
  return scope !== 'spawned' && scope !== 'agent'
}

/** Returns true when the primary was (re)pointed, false when it already
 *  pointed at this segment. Throws `NotFoundError` for a missing / foreign
 *  primary (the link op's no-enumeration contract). */
export function linkPrimaryToTurnSegment(
  db: Database,
  input: LinkPrimaryToTurnSegmentInput,
): boolean {
  const primary = primarySessionsRepository.findPrimarySessionById(db, input.primarySessionId)
  if (!primary || primary.userId !== input.userId) {
    throw new NotFoundError('primary session', input.primarySessionId)
  }
  if (primary.currentSdkSessionId === input.sdkSessionId) return false

  linkPrimarySessionToSdkSession(db, {
    primarySessionId: input.primarySessionId,
    userId: input.userId,
    sdkSessionId: input.sdkSessionId,
  })
  if (input.priorSdkSessionId === null && hidesFirstSegment(primary.scope)) {
    updateChatSession(db, input.sdkSessionId, { visibility: 'hidden' })
  }
  return true
}
