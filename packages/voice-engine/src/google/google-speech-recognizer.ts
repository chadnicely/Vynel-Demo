// Google Cloud Speech-to-Text behind the `SpeechRecognizer` contract —
// synchronous recognize on one utterance (VAD keeps segments far under the
// sync 60 s cap). The audio ships as base64 WAV; the WAV header already
// declares encoding + sample rate, so the config deliberately sends
// neither (per the Speech API's WAV handling). The API key travels ONLY
// in the `x-goog-api-key` header.

import { encodeWavFromPcm } from '../pcm-codec.js'
import { VoiceProviderRequestError } from '../voice-provider-request-error.js'
import type { PcmAudio, SpeechRecognizer } from '../voice-engine.js'

const GOOGLE_STT_API_URL = 'https://speech.googleapis.com'
const DEFAULT_LANGUAGE_CODE = 'en-US'
const TRANSCRIBE_TIMEOUT_MS = 30_000

export interface GoogleSpeechRecognizerOptions {
  readonly apiKey: string
  readonly languageCode?: string
  readonly fetchImplementation?: typeof fetch
}

interface GoogleRecognizeResponse {
  results?: {
    alternatives?: { transcript?: string }[]
  }[]
}

export class GoogleSpeechRecognizer implements SpeechRecognizer {
  readonly #apiKey: string
  readonly #languageCode: string
  readonly #fetch: typeof fetch

  constructor(options: GoogleSpeechRecognizerOptions) {
    this.#apiKey = options.apiKey
    this.#languageCode = options.languageCode ?? DEFAULT_LANGUAGE_CODE
    this.#fetch = options.fetchImplementation ?? fetch
  }

  async transcribe(audio: PcmAudio): Promise<string> {
    let response: Response
    try {
      response = await this.#fetch(`${GOOGLE_STT_API_URL}/v1/speech:recognize`, {
        method: 'POST',
        headers: { 'x-goog-api-key': this.#apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          config: { languageCode: this.#languageCode, enableAutomaticPunctuation: true },
          audio: { content: Buffer.from(encodeWavFromPcm(audio)).toString('base64') },
        }),
        signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
      })
    } catch (error) {
      throw new VoiceProviderRequestError(
        'google',
        null,
        `Google transcription unreachable: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    if (!response.ok) {
      throw new VoiceProviderRequestError(
        'google',
        response.status,
        `Google transcription failed (HTTP ${response.status})`,
      )
    }
    const body = (await response.json()) as GoogleRecognizeResponse
    return (body.results ?? [])
      .map((recognized) => recognized.alternatives?.[0]?.transcript ?? '')
      .join(' ')
      .trim()
  }
}
