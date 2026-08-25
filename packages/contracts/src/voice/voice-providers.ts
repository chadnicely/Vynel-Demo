// Cloud voice providers a user can connect with their own API key — the
// pure-data catalog every surface reads (Settings cards, engine routes,
// daemon selection). Deliberately PARALLEL to `models/local-model-catalog`,
// not part of it: a local entry is a download with an on-disk layout and a
// missing-file probe; a provider is a credential plus a network endpoint —
// none of `approxBytes`/`folder`/`layout` apply. Adding a provider = one
// entry here + one adapter in `@vynel/voice-providers` + one engine pair
// in `@vynel/voice-engine`.

export const VOICE_PROVIDER_IDS = ['elevenlabs', 'google'] as const

export type VoiceProviderId = (typeof VOICE_PROVIDER_IDS)[number]

export function isVoiceProviderId(value: string): value is VoiceProviderId {
  return (VOICE_PROVIDER_IDS as readonly string[]).includes(value)
}

/** The one credential input the connect dialog renders — always masked. */
export interface VoiceProviderCredentialField {
  readonly key: 'apiKey'
  readonly label: string
  readonly placeholder: string
}

export interface VoiceProviderCatalogEntry {
  readonly id: VoiceProviderId
  readonly label: string
  readonly tagline: string
  readonly connectHint: string
  readonly credentialField: VoiceProviderCredentialField
  readonly supports: { readonly tts: boolean; readonly stt: boolean }
}

export const VOICE_PROVIDER_CATALOG: Record<VoiceProviderId, VoiceProviderCatalogEntry> = {
  elevenlabs: {
    id: 'elevenlabs',
    label: 'ElevenLabs',
    tagline: 'Natural voices and transcription from your ElevenLabs account.',
    connectHint: 'Create an API key at elevenlabs.io under Profile → API keys, then paste it here.',
    credentialField: {
      key: 'apiKey',
      label: 'API key',
      placeholder: 'xi-…',
    },
    supports: { tts: true, stt: true },
  },
  google: {
    id: 'google',
    label: 'Google Cloud',
    tagline: 'Google Cloud voices and transcription from your own project.',
    connectHint:
      'Create an API key in Google Cloud Console with the Text-to-Speech and Speech-to-Text APIs enabled on the project.',
    credentialField: {
      key: 'apiKey',
      label: 'API key',
      placeholder: 'AIza…',
    },
    supports: { tts: true, stt: true },
  },
}

export function getVoiceProviderCatalogEntry(provider: VoiceProviderId): VoiceProviderCatalogEntry {
  return VOICE_PROVIDER_CATALOG[provider]
}

// The SOURCE picks (Settings → Voice). Speaking: the local sherpa models
// or a connected provider. Hearing: `web-speech` is the default — the
// browser overlay is the main talking surface and its recognition is free
// and word-by-word — while the always-on WAKE listening is pinned to the
// local model regardless (the room's audio never streams to a cloud API).
export const VOICE_TTS_SOURCES = ['local', ...VOICE_PROVIDER_IDS] as const
export type VoiceTtsSource = (typeof VOICE_TTS_SOURCES)[number]

export const VOICE_STT_SOURCES = ['web-speech', 'local', ...VOICE_PROVIDER_IDS] as const
export type VoiceSttSource = (typeof VOICE_STT_SOURCES)[number]

export const DEFAULT_VOICE_TTS_SOURCE: VoiceTtsSource = 'local'
export const DEFAULT_VOICE_STT_SOURCE: VoiceSttSource = 'web-speech'

export function isVoiceTtsSource(value: unknown): value is VoiceTtsSource {
  return VOICE_TTS_SOURCES.some((source) => source === value)
}

export function isVoiceSttSource(value: unknown): value is VoiceSttSource {
  return VOICE_STT_SOURCES.some((source) => source === value)
}

/** A provider voice the user can pick for speaking (fetched live — the
 *  ElevenLabs list is account-scoped; Google's is global and huge, so the
 *  picker filters by language client-side). */
export interface VoiceProviderVoice {
  readonly id: string
  readonly label: string
  readonly language: string | null
}
