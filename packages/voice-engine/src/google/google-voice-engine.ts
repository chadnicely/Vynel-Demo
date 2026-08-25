// Google Cloud TTS behind the `VoiceEngine` contract. The provider voice
// (a name like "en-US-Neural2-C") is fixed at construction; its language
// code is derivable from the name, so callers only pass one when the name
// deviates. LINEAR16 output arrives WAV-headered — decoded straight to
// `PcmAudio`. The API key travels ONLY in the `x-goog-api-key` header,
// never a `?key=` query param (URLs land in logs).

import { decodeWavToPcm } from '../pcm-codec.js'
import { VoiceProviderRequestError } from '../voice-provider-request-error.js'
import type { PcmAudio, SynthesizeOptions, VoiceEngine } from '../voice-engine.js'

const GOOGLE_TTS_API_URL = 'https://texttospeech.googleapis.com'
const OUTPUT_SAMPLE_RATE = 24_000
const SYNTHESIS_TIMEOUT_MS = 30_000

export interface GoogleVoiceEngineOptions {
  readonly apiKey: string
  /** A Google voice name, e.g. "en-US-Neural2-C". */
  readonly voiceName: string
  readonly languageCode?: string
  readonly fetchImplementation?: typeof fetch
}

export class GoogleVoiceEngine implements VoiceEngine {
  readonly sampleRate = OUTPUT_SAMPLE_RATE
  readonly voiceCount = 1
  readonly #apiKey: string
  readonly #voiceName: string
  readonly #languageCode: string
  readonly #fetch: typeof fetch

  constructor(options: GoogleVoiceEngineOptions) {
    this.#apiKey = options.apiKey
    this.#voiceName = options.voiceName
    this.#languageCode = options.languageCode ?? deriveLanguageCode(options.voiceName)
    this.#fetch = options.fetchImplementation ?? fetch
  }

  async synthesize(text: string, options?: SynthesizeOptions): Promise<PcmAudio> {
    let response: Response
    try {
      response = await this.#fetch(`${GOOGLE_TTS_API_URL}/v1/text:synthesize`, {
        method: 'POST',
        headers: { 'x-goog-api-key': this.#apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          input: { text },
          voice: { name: this.#voiceName, languageCode: this.#languageCode },
          audioConfig: {
            audioEncoding: 'LINEAR16',
            sampleRateHertz: OUTPUT_SAMPLE_RATE,
            ...(options?.speed !== undefined && { speakingRate: options.speed }),
          },
        }),
        signal: AbortSignal.timeout(SYNTHESIS_TIMEOUT_MS),
      })
    } catch (error) {
      throw new VoiceProviderRequestError(
        'google',
        null,
        `Google synthesis unreachable: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    if (!response.ok) {
      throw new VoiceProviderRequestError(
        'google',
        response.status,
        `Google synthesis failed (HTTP ${response.status})`,
      )
    }
    const body = (await response.json()) as { audioContent?: unknown }
    if (typeof body.audioContent !== 'string') {
      throw new VoiceProviderRequestError('google', null, 'Google synthesis answered no audio')
    }
    return decodeWavToPcm(new Uint8Array(Buffer.from(body.audioContent, 'base64')))
  }
}

// "en-US-Neural2-C" → "en-US". Every catalog voice name carries its locale
// as the first two segments; a future exception passes `languageCode`.
function deriveLanguageCode(voiceName: string): string {
  return voiceName.split('-').slice(0, 2).join('-')
}
