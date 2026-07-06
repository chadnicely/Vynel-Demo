import { OfflineTts } from './native.js'
import type { PcmAudio, SynthesizeOptions, VoiceEngine } from '../voice-engine.js'
import { buildOfflineTtsConfig } from './build-offline-tts-config.js'
import type { BuildOfflineTtsConfigInput } from './build-offline-tts-config.js'

// The sherpa-onnx-node text-to-speech engine. Loads the ONNX model once in the
// constructor (a genuinely stateful native resource → a class, per CLAUDE.md)
// and synthesizes on demand. The native lib is imported ONLY here (+ the ambient
// shim) — the anti-corruption boundary, so a sherpa-onnx change lands in one
// folder and never reaches a consumer through the VoiceEngine contract.

const DEFAULT_SPEED = 1
const DEFAULT_VOICE_ID = 0

export type SherpaVoiceEngineOptions = BuildOfflineTtsConfigInput

export class SherpaVoiceEngine implements VoiceEngine {
  readonly #tts: OfflineTts
  /** The model's native output rate (Hz) — exposed so a caller can resample. */
  readonly sampleRate: number
  /** How many speakers the loaded model offers (Kokoro: 11; piper: 1). */
  readonly voiceCount: number

  constructor(options: SherpaVoiceEngineOptions) {
    this.#tts = new OfflineTts(buildOfflineTtsConfig(options))
    this.sampleRate = this.#tts.sampleRate
    this.voiceCount = this.#tts.numSpeakers
  }

  // `generateAsync` runs the model off the main thread, so a synthesis never
  // blocks the event loop that's also streaming audio back to the browser.
  async synthesize(text: string, options?: SynthesizeOptions): Promise<PcmAudio> {
    const audio = await this.#tts.generateAsync({
      text,
      sid: options?.voiceId ?? DEFAULT_VOICE_ID,
      speed: options?.speed ?? DEFAULT_SPEED,
    })
    return { samples: audio.samples, sampleRate: audio.sampleRate }
  }
}
