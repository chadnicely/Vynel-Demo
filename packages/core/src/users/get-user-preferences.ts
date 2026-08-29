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
import { isValidAudioDeviceName } from '@vynel/contracts/voice/audio-devices'
import {
  DEFAULT_VOICE_STT_SOURCE,
  DEFAULT_VOICE_TTS_SOURCE,
  isValidWakeName,
  isVoiceSttSource,
  isVoiceTtsSource,
  type VoiceSttSource,
  type VoiceTtsSource,
} from '@vynel/contracts/voice/voice-providers'
import {
  VOICE_TIER_MODEL,
  DEFAULT_VOICE_TIER_THINKING,
  isVoiceTierModel,
  isVoiceTierThinking,
  type VoiceTierModel,
  type VoiceTierThinking,
} from '@vynel/contracts/chat/voice-tier'

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
  // The cloud-provider extension (voice-cloud-providers, 2026-08-26): WHERE
  // speaking and hearing run. The local model ids above keep meaning the
  // LOCAL pick (the STT one = the wake model, which never leaves the machine);
  // a provider source additionally needs its string voice id for speaking.
  voiceTtsSource: VoiceTtsSource
  voiceTtsProviderVoiceId: string | null
  voiceSttSource: VoiceSttSource
  // The custom wake name (2026-08-28): "hey <name>" wakes the daemon BESIDE
  // the built-in names. Null = built-ins only.
  voiceWakeName: string | null
  // The DEVICE picks (Settings → Voice, 2026-08-28): WHICH microphone hears
  // and WHICH speaker answers. Stored as device NAMES, never ids — a browser
  // deviceId is origin-scoped and rotates, a cpal id is opaque, and only a
  // name re-resolves on a second machine. Null = the system default, which is
  // also where every consumer falls back when the named device is absent.
  voiceInputDeviceName: string | null
  voiceOutputDeviceName: string | null
  // Settings → Desktop control (2026-08-23): may Vynel CLICK and TYPE on this
  // desktop? Looking (screenshots, window lists) is never gated. Fail-closed
  // default; `VYNEL_DESKTOP_ACT_ENABLED` seeds it only while the user has
  // never touched the toggle — see `resolveDesktopActionsEnabled` in local-api.
  desktopActionsEnabled: boolean
  // The voice TIER (Settings → Voice, voice-lean arc 2026-08-27): which brain
  // speaks — haiku (fast) or sonnet (the fallback pick) — and whether it
  // thinks before speaking ('off' = the fast default). USER-level by design:
  // the D2 rule stands (no voice turn reads or writes per-session settings).
  // `VYNEL_VOICE_TIER_MODEL` (a dev/support env override) outranks the stored
  // model pick — see `resolveVoiceTierSettings` in local-api.
  voiceTierModel: VoiceTierModel
  voiceTierThinking: VoiceTierThinking
}

export const DEFAULT_PREFERENCES: ResolvedUserPreferences = {
  theme: 'system',
  defaultWorkspaceId: null,
  chatStreamingEnabled: true,
  reducedMotion: false,
  voiceTtsModelId: DEFAULT_TTS_MODEL_ID,
  voiceSpeakerId: 0,
  voiceSttModelId: DEFAULT_STT_MODEL_ID,
  voiceTtsSource: DEFAULT_VOICE_TTS_SOURCE,
  voiceTtsProviderVoiceId: null,
  voiceSttSource: DEFAULT_VOICE_STT_SOURCE,
  voiceWakeName: null,
  voiceInputDeviceName: null,
  voiceOutputDeviceName: null,
  desktopActionsEnabled: false,
  voiceTierModel: VOICE_TIER_MODEL,
  voiceTierThinking: DEFAULT_VOICE_TIER_THINKING,
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
      case 'voiceTtsSource':
        // A source whose provider was later removed falls back to 'local'
        // via the guard — the daemon must never chase a retired provider.
        if (isVoiceTtsSource(parsed)) resolved.voiceTtsSource = parsed
        break
      case 'voiceTtsProviderVoiceId':
        if (typeof parsed === 'string' && parsed.length > 0) {
          resolved.voiceTtsProviderVoiceId = parsed
        }
        break
      case 'voiceSttSource':
        if (isVoiceSttSource(parsed)) resolved.voiceSttSource = parsed
        break
      case 'voiceWakeName':
        // The empty string is the CLEAR (back to built-ins only); anything
        // else must satisfy the shared predicate the daemon matches with.
        if (parsed === '') resolved.voiceWakeName = null
        else if (isValidWakeName(parsed)) resolved.voiceWakeName = parsed
        break
      case 'voiceInputDeviceName':
        // The empty string is the CLEAR (back to the system default).
        if (parsed === '') resolved.voiceInputDeviceName = null
        else if (isValidAudioDeviceName(parsed)) resolved.voiceInputDeviceName = parsed
        break
      case 'voiceOutputDeviceName':
        if (parsed === '') resolved.voiceOutputDeviceName = null
        else if (isValidAudioDeviceName(parsed)) resolved.voiceOutputDeviceName = parsed
        break
      case 'desktopActionsEnabled':
        // The fail-closed `false` this falls back to is the ROW default — what
        // a user who has never touched the toggle reads back. It is NOT the
        // engine's effective value: a turn resolves acting through
        // `resolveDesktopActionsEnabled` (apps/local-api), which falls through
        // an untouched row to the `VYNEL_DESKTOP_ACT_ENABLED` dev seed.
        if (typeof parsed === 'boolean') {
          resolved.desktopActionsEnabled = parsed
        }
        break
      case 'voiceTierModel':
        // A model outside the tier's pair (a retired pick) reads as never
        // chosen — the spoken thread must never chase a model off the tier.
        if (isVoiceTierModel(parsed)) resolved.voiceTierModel = parsed
        break
      case 'voiceTierThinking':
        if (isVoiceTierThinking(parsed)) resolved.voiceTierThinking = parsed
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
