// The one provider-id → engine-pair switch. Callers (the engine's cloud
// routes, tests) hand in the opened key and get contract-shaped engines
// back — nobody else may map a provider id to a concrete class, so adding
// a provider is one arm here (the compiler enforces exhaustiveness).

import { ElevenLabsSpeechRecognizer } from './elevenlabs/elevenlabs-speech-recognizer.js'
import { ElevenLabsVoiceEngine } from './elevenlabs/elevenlabs-voice-engine.js'
import { GoogleSpeechRecognizer } from './google/google-speech-recognizer.js'
import { GoogleVoiceEngine } from './google/google-voice-engine.js'
import type { VoiceProviderId } from '@vynel/contracts/voice/voice-providers'
import type { SpeechRecognizer, VoiceEngine } from './voice-engine.js'

export interface CreateProviderVoiceEngineInput {
  readonly provider: VoiceProviderId
  readonly apiKey: string
  /** The provider's voice id — an ElevenLabs voice_id or a Google voice name. */
  readonly providerVoiceId: string
  readonly fetchImplementation?: typeof fetch
}

export function createProviderVoiceEngine(
  input: CreateProviderVoiceEngineInput,
): VoiceEngine & { readonly sampleRate: number; readonly voiceCount: number } {
  const fetchImplementation = input.fetchImplementation ?? fetch
  switch (input.provider) {
    case 'elevenlabs':
      return new ElevenLabsVoiceEngine({
        apiKey: input.apiKey,
        voiceId: input.providerVoiceId,
        fetchImplementation,
      })
    case 'google':
      return new GoogleVoiceEngine({
        apiKey: input.apiKey,
        voiceName: input.providerVoiceId,
        fetchImplementation,
      })
    default: {
      const unsupported: never = input.provider
      throw new Error(`Unsupported voice provider: ${String(unsupported)}`)
    }
  }
}

export interface CreateProviderSpeechRecognizerInput {
  readonly provider: VoiceProviderId
  readonly apiKey: string
  readonly fetchImplementation?: typeof fetch
}

export function createProviderSpeechRecognizer(
  input: CreateProviderSpeechRecognizerInput,
): SpeechRecognizer {
  const fetchImplementation = input.fetchImplementation ?? fetch
  switch (input.provider) {
    case 'elevenlabs':
      return new ElevenLabsSpeechRecognizer({ apiKey: input.apiKey, fetchImplementation })
    case 'google':
      return new GoogleSpeechRecognizer({ apiKey: input.apiKey, fetchImplementation })
    default: {
      const unsupported: never = input.provider
      throw new Error(`Unsupported voice provider: ${String(unsupported)}`)
    }
  }
}
