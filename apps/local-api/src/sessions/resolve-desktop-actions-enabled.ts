// May Vynel ACT on this desktop — resolved PER TURN,
// at the moment a turn composes its MCP servers, so flipping the Settings
// toggle takes effect on the next turn without restarting the engine.
//
// "Act" is the WHOLE act toolset, not just click/type: acting in apps, launching
// apps, opening links, the three window tools, volume, and BOTH clipboard tools
// — the clipboard READ included, since it can surface a just-copied password.
//
// LOOKING (screenshots, window lists, notifications) is never gated by this —
// the read-only desktop tools ride every turn the listener is up for. This
// decides only whether the MUTATING act tools are composed, and every act it
// permits is still written to the append-only `desktop_actions` record.
//
// Precedence — the user's choice always wins:
//   1. the `desktopActionsEnabled` preference row, when the user has set it
//   2. otherwise `VYNEL_DESKTOP_ACT_ENABLED` (a DEV seed; default off)
// The env knob is deliberately only a seed for the never-touched state, so a
// developer can run with acting on without the Settings toggle lying about it.

import { findPreferenceForUser } from '@vynel/db/repositories/users'
import type { Database } from '@vynel/db'
import { loadEnv } from '../env.js'

/** The `user_preferences` key — the SAME literal the users route's Zod field
 *  name serializes to (`setUserPreferences` upserts by property name). */
export const DESKTOP_ACTIONS_PREFERENCE_KEY = 'desktopActionsEnabled'

export function resolveDesktopActionsEnabled(db: Database, userId: string): boolean {
  const stored = findPreferenceForUser(db, userId, DESKTOP_ACTIONS_PREFERENCE_KEY)
  if (stored !== null) {
    const chosen = safelyParse(stored.preferenceValue)
    // A malformed or non-boolean row reads as "never chosen" rather than as a
    // silent yes — the same forgiving parse `getUserPreferences` applies.
    if (typeof chosen === 'boolean') return chosen
  }
  return loadEnv().VYNEL_DESKTOP_ACT_ENABLED
}

function safelyParse(rawValue: string): unknown {
  try {
    return JSON.parse(rawValue)
  } catch {
    return null
  }
}
