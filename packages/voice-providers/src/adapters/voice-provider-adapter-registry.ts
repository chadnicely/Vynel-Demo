// The voice-provider adapter registry — `resolveVoiceProviderAdapter(id)`
// returns a lazy singleton per provider, mirroring channels'
// `resolveChannelAdapter`. Adapters are stateless apart from their fetch
// binding, so one instance per process is plenty.

import { ValidationError } from '@vynel/errors'
import { ElevenLabsVoiceProviderAdapter } from './elevenlabs/elevenlabs-voice-provider-adapter.js'
import { GoogleVoiceProviderAdapter } from './google/google-voice-provider-adapter.js'
import type { VoiceProviderId } from '@vynel/contracts/voice/voice-providers'
import type { VoiceProviderAdapter } from './voice-provider-adapter.js'

const adaptersByProvider = new Map<VoiceProviderId, VoiceProviderAdapter>()

export function resolveVoiceProviderAdapter(provider: VoiceProviderId): VoiceProviderAdapter {
  const cached = adaptersByProvider.get(provider)
  if (cached) return cached

  switch (provider) {
    case 'elevenlabs': {
      const adapter = new ElevenLabsVoiceProviderAdapter()
      adaptersByProvider.set(provider, adapter)
      return adapter
    }
    case 'google': {
      const adapter = new GoogleVoiceProviderAdapter()
      adaptersByProvider.set(provider, adapter)
      return adapter
    }
    default: {
      const unsupported: never = provider
      throw new ValidationError(`Unsupported voice provider: ${String(unsupported)}.`)
    }
  }
}
