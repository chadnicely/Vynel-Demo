// The ONE home that decides what "now" a turn is told. Both provider-message
// composition homes call it — `start-chat-turn.ts` (workspace chat, a spawned
// session DM, a fired workspace turn) and `compose-global-root-provider-message.ts`
// (global chat, voice, channels, a fired global turn) — so every interactive
// turn carries the same line exactly once, and there is one place to change
// what it says.
//
// The zone is the USER's (`users.timezone`, IANA, seeded from the OS at first
// boot and editable in onboarding) — not the host process's, which is a
// different machine the moment the engine runs remotely.

import { findUserById } from '@vynel/db/repositories/users'
import { renderTurnTimeMarker } from '@vynel/instructions/session-instructions'
import type { Database } from '@vynel/db'

export function resolveTurnTimeMarker(db: Database, userId: string, now = new Date()): string {
  // `users.timezone` is NOT NULL, so the fallback only covers a turn composed
  // for a user row that no longer exists — UTC states an honest zone rather
  // than borrowing the host's.
  const timeZone = findUserById(db, userId)?.timezone ?? 'UTC'
  return renderTurnTimeMarker(now, timeZone)
}
