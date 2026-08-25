// A reply must never go silent (voice-realtime VR1): when the primary
// engine fails — a cloud provider down, a revoked key — the fallback
// speaks the sentence instead. The fallback is a THUNK because the local
// engine behind it can be hot-swapped by a reload; `onFallback` lets the
// shell log the swap without this package knowing about loggers.

import type { PcmAudio, SynthesizeOptions, VoiceEngine } from './voice-engine.js'

export interface FallbackVoiceEngineOptions {
  readonly primary: VoiceEngine & { readonly sampleRate: number; readonly voiceCount: number }
  readonly fallback: () => VoiceEngine
  readonly onFallback?: (error: unknown) => void
}

export class FallbackVoiceEngine implements VoiceEngine {
  readonly sampleRate: number
  readonly voiceCount: number
  readonly #options: FallbackVoiceEngineOptions

  constructor(options: FallbackVoiceEngineOptions) {
    this.#options = options
    this.sampleRate = options.primary.sampleRate
    this.voiceCount = options.primary.voiceCount
  }

  async synthesize(text: string, options?: SynthesizeOptions): Promise<PcmAudio> {
    try {
      return await this.#options.primary.synthesize(text, options)
    } catch (error) {
      this.#options.onFallback?.(error)
      return this.#options.fallback().synthesize(text, options)
    }
  }
}
