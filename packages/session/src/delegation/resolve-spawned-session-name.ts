// A spawned session's DISPLAY NAME, read fresh off its current segment's title
// (the first, listed segment names it; after a rare mid-turn swap the stock
// hidden title falls back to 'Session'). ONE home for the reading — the
// claim-and-run tick attributes the routed turn with it, and the in-flight
// decorator labels the processing chip with it — so the chip and the reply
// can never name the same session differently.

import type { Database } from '@vynel/db'
import { findChatSessionById } from '@vynel/chat/repositories'
import type { PrimarySessionRow } from '../repositories/index.js'

export function resolveSpawnedSessionDisplayName(
  db: Database,
  primary: PrimarySessionRow | null,
): string {
  const currentSegment =
    primary?.currentSdkSessionId != null
      ? findChatSessionById(db, primary.currentSdkSessionId)
      : null
  return currentSegment !== null && currentSegment.visibility === 'listed'
    ? currentSegment.title
    : 'Session'
}
