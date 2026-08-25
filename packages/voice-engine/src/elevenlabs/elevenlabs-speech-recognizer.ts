// ElevenLabs Scribe STT behind the `SpeechRecognizer` contract — one
// utterance in as a WAV upload, its transcript out. Language is
// auto-detected unless pinned. The API key travels ONLY in the
// `xi-api-key` header.

import { encodeWavFromPcm } from '../pcm-codec.js'
import { VoiceProviderRequestError } from '../voice-provider-request-error.js'
import type { PcmAudio, SpeechRecognizer } from '../voice-engine.js'

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io'
const DEFAULT_ELEVENLABS_STT_MODEL = 'scribe_v2'
const TRANSCRIBE_TIMEOUT_MS = 30_000

export interface ElevenLabsSpeechRecognizerOptions {
  readonly apiKey: string
  readonly modelId?: string
  /** ISO-639 code to pin recognition to one language; omitted = auto-detect. */
  readonly languageCode?: string
  readonly fetchImplementation?: typeof fetch
}

export class ElevenLabsSpeechRecognizer implements SpeechRecognizer {
  readonly #apiKey: string
  readonly #modelId: string
  readonly #languageCode: string | null
  readonly #fetch: typeof fetch

  constructor(options: ElevenLabsSpeechRecognizerOptions) {
    this.#apiKey = options.apiKey
    this.#modelId = options.modelId ?? DEFAULT_ELEVENLABS_STT_MODEL
    this.#languageCode = options.languageCode ?? null
    this.#fetch = options.fetchImplementation ?? fetch
  }

  async transcribe(audio: PcmAudio): Promise<string> {
    const form = new FormData()
    form.append('model_id', this.#modelId)
    if (this.#languageCode !== null) form.append('language_code', this.#languageCode)
    form.append(
      'file',
      new Blob([encodeWavFromPcm(audio)], { type: 'audio/wav' }),
      'utterance.wav',
    )

    let response: Response
    try {
      // No content-type header — FormData sets the multipart boundary itself.
      response = await this.#fetch(`${ELEVENLABS_API_URL}/v1/speech-to-text`, {
        method: 'POST',
        headers: { 'xi-api-key': this.#apiKey },
        body: form,
        signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
      })
    } catch (error) {
      throw new VoiceProviderRequestError(
        'elevenlabs',
        null,
        `ElevenLabs transcription unreachable: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    if (!response.ok) {
      throw new VoiceProviderRequestError(
        'elevenlabs',
        response.status,
        `ElevenLabs transcription failed (HTTP ${response.status})`,
      )
    }
    const body = (await response.json()) as { text?: unknown }
    return typeof body.text === 'string' ? body.text : ''
  }
}
