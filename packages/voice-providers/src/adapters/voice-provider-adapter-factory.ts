// The one provider-id → adapter switch, mirroring channels'
// `resolveChannelAdapter` — but a plain per-call factory, not a cached
// singleton: these adapters hold no state beyond their fetch binding, and
// the optional `fetchImplementation` lets route tests drive the REAL
// adapters against a fake network.

import { ValidationError } from '@vynel/errors'
import { ElevenLabsVoiceProviderAdapter } from './elevenlabs/elevenlabs-voice-provider-adapter.js'
import { GoogleVoiceProviderAdapter } from './google/google-voice-provider-adapter.js'
import type { VoiceProviderId } from '@vynel/contracts/voice/voice-providers'
import type { VoiceProviderAdapter } from './voice-provider-adapter.js'

export function createVoiceProviderAdapter(
  provider: VoiceProviderId,
  fetchImplementation: typeof fetch = fetch,
): VoiceProviderAdapter {
  switch (provider) {
    case 'elevenlabs':
      return new ElevenLabsVoiceProviderAdapter(fetchImplementation)
    case 'google':
      return new GoogleVoiceProviderAdapter(fetchImplementation)
    default: {
      const unsupported: never = provider
      throw new ValidationError(`Unsupported voice provider: ${String(unsupported)}.`)
    }
  }
}
