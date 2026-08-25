// ElevenLabs TTS behind the `VoiceEngine` contract. The provider voice is
// fixed at construction (cloud voice ids are strings — the numeric
// `SynthesizeOptions.voiceId` speaker knob is a sherpa concept and is
// ignored here). Output is requested as raw pcm_24000 — available on
// every tier (only 44.1 kHz PCM is Pro-gated) and a straight Int16→Float32
// map away from `PcmAudio`. The API key travels ONLY in the `xi-api-key`
// header; `output_format` in the query string carries no secret.

import { int16BytesToFloat32 } from '../pcm-codec.js'
import { VoiceProviderRequestError } from '../voice-provider-request-error.js'
import type { PcmAudio, SynthesizeOptions, VoiceEngine } from '../voice-engine.js'

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io'
const DEFAULT_ELEVENLABS_TTS_MODEL = 'eleven_multilingual_v2'
const OUTPUT_SAMPLE_RATE = 24_000
const SYNTHESIS_TIMEOUT_MS = 30_000

export interface ElevenLabsVoiceEngineOptions {
  readonly apiKey: string
  readonly voiceId: string
  readonly modelId?: string
  readonly fetchImplementation?: typeof fetch
}

export class ElevenLabsVoiceEngine implements VoiceEngine {
  readonly sampleRate = OUTPUT_SAMPLE_RATE
  readonly voiceCount = 1
  readonly #apiKey: string
  readonly #voiceId: string
  readonly #modelId: string
  readonly #fetch: typeof fetch

  constructor(options: ElevenLabsVoiceEngineOptions) {
    this.#apiKey = options.apiKey
    this.#voiceId = options.voiceId
    this.#modelId = options.modelId ?? DEFAULT_ELEVENLABS_TTS_MODEL
    this.#fetch = options.fetchImplementation ?? fetch
  }

  async synthesize(text: string, options?: SynthesizeOptions): Promise<PcmAudio> {
    let response: Response
    try {
      response = await this.#fetch(
        `${ELEVENLABS_API_URL}/v1/text-to-speech/${encodeURIComponent(this.#voiceId)}` +
          `?output_format=pcm_${OUTPUT_SAMPLE_RATE}`,
        {
          method: 'POST',
          headers: { 'xi-api-key': this.#apiKey, 'content-type': 'application/json' },
          body: JSON.stringify({
            text,
            model_id: this.#modelId,
            ...(options?.speed !== undefined && { voice_settings: { speed: options.speed } }),
          }),
          signal: AbortSignal.timeout(SYNTHESIS_TIMEOUT_MS),
        },
      )
    } catch (error) {
      throw new VoiceProviderRequestError(
        'elevenlabs',
        null,
        `ElevenLabs synthesis unreachable: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    if (!response.ok) {
      throw new VoiceProviderRequestError(
        'elevenlabs',
        response.status,
        `ElevenLabs synthesis failed (HTTP ${response.status})`,
      )
    }
    const pcmBytes = new Uint8Array(await response.arrayBuffer())
    return { samples: int16BytesToFloat32(pcmBytes), sampleRate: OUTPUT_SAMPLE_RATE }
  }
}
