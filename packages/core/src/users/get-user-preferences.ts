// Returns the user's preferences as a typed object with defaults filled.
// Unknown keys in storage are silently ignored (forward-compat: a future
// version can introduce a new key without breaking older clients reading
// the same database). Per `docs/blueprints/users/blueprint.md §5.4` +
// decision D5 ("Defaults live in core, not in the database").

import { listPreferencesForUser } from '@vynel/db/repositories/users'
import type { Database } from '@vynel/db'
import {
  DEFAULT_STT_MODEL_ID,
  DEFAULT_TTS_MODEL_ID,
  LOCAL_STT_MODEL_IDS,
  LOCAL_TTS_MODEL_IDS,
  type LocalSttModelId,
  type LocalTtsModelId,
} from '@vynel/contracts/models/local-model-catalog'

export interface ResolvedUserPreferences {
  theme: 'light' | 'dark' | 'system'
  defaultWorkspaceId: string | null
  chatStreamingEnabled: boolean
  reducedMotion: boolean
  // The voice (Settings → Voice, 2026-08-22): which model speaks, as whom, and
  // which model hears. Catalog ids; a retired id falls back to the default.
  voiceTtsModelId: LocalTtsModelId
  voiceSpeakerId: number
  voiceSttModelId: LocalSttModelId
}

export const DEFAULT_PREFERENCES: ResolvedUserPreferences = {
  theme: 'system',
  defaultWorkspaceId: null,
  chatStreamingEnabled: true,
  reducedMotion: false,
  voiceTtsModelId: DEFAULT_TTS_MODEL_ID,
  voiceSpeakerId: 0,
  voiceSttModelId: DEFAULT_STT_MODEL_ID,
}

function isTtsModelId(value: unknown): value is LocalTtsModelId {
  return LOCAL_TTS_MODEL_IDS.some((id) => id === value)
}

function isSttModelId(value: unknown): value is LocalSttModelId {
  return LOCAL_STT_MODEL_IDS.some((id) => id === value)
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
      case 'voiceTtsModelId':
        if (isTtsModelId(parsed)) resolved.voiceTtsModelId = parsed
        break
      case 'voiceSpeakerId':
        if (typeof parsed === 'number' && Number.isInteger(parsed) && parsed >= 0) {
          resolved.voiceSpeakerId = parsed
        }
        break
      case 'voiceSttModelId':
        if (isSttModelId(parsed)) resolved.voiceSttModelId = parsed
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
