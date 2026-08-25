// The stripping boundary for voice-provider responses: a connection row
// carries the sealed credential blob — it dies here. Every route answers
// catalog facts + connection state only.

import type {
  VoiceProviderCatalogEntry,
} from '@vynel/contracts/voice/voice-providers'
import type { VoiceProviderConnection } from '@vynel/voice-providers'
import type { VoiceProviderStatus } from './schemas.js'

export function serializeVoiceProviderStatus(
  entry: VoiceProviderCatalogEntry,
  connection: VoiceProviderConnection | null,
): VoiceProviderStatus {
  return {
    id: entry.id,
    label: entry.label,
    tagline: entry.tagline,
    connectHint: entry.connectHint,
    credentialField: {
      key: entry.credentialField.key,
      label: entry.credentialField.label,
      placeholder: entry.credentialField.placeholder,
    },
    supports: { tts: entry.supports.tts, stt: entry.supports.stt },
    connected: connection !== null,
    accountLabel: connection?.accountLabel ?? null,
    connectedAt: connection?.createdAt.toISOString() ?? null,
  }
}
