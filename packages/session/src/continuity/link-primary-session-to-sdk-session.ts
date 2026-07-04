// `linkPrimarySessionToSdkSession` — points a primary at the SDK session it is
// currently running on, WITHOUT recording a supersession (that is the swap's
// job — `bridgePrimarySession`). Used at the turn boundary on the FIRST primary turn:
// the primary is created with `currentSdkSessionId = null`, the first turn starts a
// fresh SDK session, and this links the primary to it so every later turn resumes
// the same session (and the swap has a `from` session to bridge).
//
// Idempotent in effect: re-linking to the same id is a harmless no-op write.
// Throws `NotFoundError` (tenant-checked) when the primary doesn't exist or isn't
// owned by the caller — same no-enumeration contract as `bridgePrimarySession`.
// Spec: build brief Slice 1 §2.1 + `docs/agent-base/session-continuity.md`
// Open #5 (the primary ↔ chat-session linkage).

import type { Database } from '@vynel/db'
import { NotFoundError } from '@vynel/errors'
import * as primarySessionsRepository from '../repositories/index.js'
import type { PrimarySessionRow } from '../repositories/index.js'

export type LinkPrimarySessionToSdkSessionInput = {
  primarySessionId: string
  userId: string
  /** The SDK session the primary now runs on. */
  sdkSessionId: string
}

export function linkPrimarySessionToSdkSession(
  db: Database,
  input: LinkPrimarySessionToSdkSessionInput,
): PrimarySessionRow {
  const linked = primarySessionsRepository.repointPrimarySession(db, {
    primarySessionId: input.primarySessionId,
    userId: input.userId,
    currentSdkSessionId: input.sdkSessionId,
    // No supersession — this is the initial link, not a swap.
  })
  if (linked === null) {
    throw new NotFoundError('primary session', input.primarySessionId)
  }
  return linked
}
