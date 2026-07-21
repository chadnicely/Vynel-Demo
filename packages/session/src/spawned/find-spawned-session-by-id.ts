// `findSpawnedSessionById` — resolves a spawned session's PRIMARY by its own
// (stable) primary id, tenant- and scope-checked like its by-segment sibling.
// The session-turn stream's re-read home (sessions-surface Slice ③a): after a
// user turn queues behind a delegated run on the same target, the handle it
// resolved with may be a superseded segment — the head must be re-read by the
// primary id so the turn resumes the CURRENT segment (locked decision 2: chat
// always lands at the chain head; a dead segment is never written).

import type { Database } from '@vynel/db'
import * as primarySessionsRepository from '../repositories/index.js'
import type { PrimarySessionRow } from '../repositories/index.js'

export type FindSpawnedSessionByIdInput = {
  userId: string
  /** The spawned primary's own id (`PrimarySessionRow.id`). */
  primarySessionId: string
}

export function findSpawnedSessionById(
  db: Database,
  input: FindSpawnedSessionByIdInput,
): PrimarySessionRow | null {
  const primary = primarySessionsRepository.findPrimarySessionById(db, input.primarySessionId)
  if (primary === null || primary.userId !== input.userId || primary.scope !== 'spawned') {
    return null
  }
  return primary
}
