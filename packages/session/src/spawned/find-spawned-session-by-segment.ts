// `findSpawnedSessionBySegmentId` — resolves a spawned session's PRIMARY from
// the handle the tools speak: the session id `list_sessions` shows and
// `create_session` returns (the entry's CURRENT segment — its newest chat
// session id, which a live primary points at). One home for the
// `send_task_to_session` route's target resolution: tenant-checked, and only a
// scope-'spawned' primary resolves — a workspace/global/voice segment id
// returns null (those targets have their own tools; the caller 404s).

import type { Database } from '@vynel/db'
import * as primarySessionsRepository from '../repositories/index.js'
import type { PrimarySessionRow } from '../repositories/index.js'

export type FindSpawnedSessionBySegmentIdInput = {
  userId: string
  /** The session id shown by list_sessions — the spawned primary's current segment. */
  sessionId: string
}

export function findSpawnedSessionBySegmentId(
  db: Database,
  input: FindSpawnedSessionBySegmentIdInput,
): PrimarySessionRow | null {
  const primary = primarySessionsRepository.findPrimarySessionByCurrentSdkSessionId(
    db,
    input.sessionId,
  )
  if (primary === null || primary.userId !== input.userId || primary.scope !== 'spawned') {
    return null
  }
  return primary
}
