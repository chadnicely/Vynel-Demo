// Returns the user's preferences as a typed object with defaults filled.
// Unknown keys in storage are silently ignored (forward-compat: a future
// version can introduce a new key without breaking older clients reading
// the same database). Per `docs/blueprints/users/blueprint.md §5.4` +
// decision D5 ("Defaults live in core, not in the database").

import { listPreferencesForUser } from '@vynel/db/repositories/users'
import type { Database } from '@vynel/db'

export interface ResolvedUserPreferences {
  theme: 'light' | 'dark' | 'system'
  defaultWorkspaceId: string | null
  chatStreamingEnabled: boolean
  reducedMotion: boolean
}

export const DEFAULT_PREFERENCES: ResolvedUserPreferences = {
  theme: 'system',
  defaultWorkspaceId: null,
  chatStreamingEnabled: true,
  reducedMotion: false,
}

export function getUserPreferences(db: Database, userId: string): ResolvedUserPreferences {
  const stored = listPreferencesForUser(db, userId)
  const resolved: ResolvedUserPreferences = { ...DEFAULT_PREFERENCES }

  for (const preference of stored) {
    const parsed = safelyParse(preference.preferenceValue)
    if (parsed === null) continue

    switch (preference.preferenceKey) {
      case 'theme':
        if (parsed === 'light' || parsed === 'dark' || parsed === 'system') {
          resolved.theme = parsed
        }
        break
      case 'defaultWorkspaceId':
        if (typeof parsed === 'string') {
          resolved.defaultWorkspaceId = parsed
        }
        break
      case 'chatStreamingEnabled':
        if (typeof parsed === 'boolean') {
          resolved.chatStreamingEnabled = parsed
        }
        break
      case 'reducedMotion':
        if (typeof parsed === 'boolean') {
          resolved.reducedMotion = parsed
        }
        break
      // Unknown keys: silently ignored (forward-compat).
    }
  }

  return resolved
}

function safelyParse(rawValue: string): unknown {
  try {
    return JSON.parse(rawValue)
  } catch {
    return null
  }
}
