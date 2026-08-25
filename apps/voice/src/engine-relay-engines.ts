// The provider-backed engines, as this daemon sees them: thin HTTP relays
// to the engine's cloud doors. The daemon holds NO credential — the engine
// opens the sealed key, calls the provider, and answers WAV/text; these
// classes are transport only. They are also SOURCE-agnostic on purpose:
// the engine resolves WHICH provider and voice from the user's saved pick
// per request, so switching provider (or voice) never swaps a daemon
// engine — only a local↔relay flip does.

import { decodeWavToPcm, encodeWavFromPcm } from '@vynel/voice-engine/pcm-codec'
import type { PcmAudio, SpeechRecognizer, VoiceEngine } from '@vynel/voice-engine'

const RELAY_TIMEOUT_MS = 45_000
// Both providers answer 24 kHz today; the decoded PcmAudio carries the
// authoritative rate either way — this number only feeds the holder's typing.
const RELAY_SAMPLE_RATE = 24_000

export class EngineRelayUnavailableError extends Error {
  constructor(
    readonly status: number | null,
    message: string,
  ) {
    super(message)
    this.name = 'EngineRelayUnavailableError'
  }
}

async function describeRelayFault(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } }
    if (body.error?.message) return body.error.message
  } catch {
    // Non-JSON fault — the status is the fact.
  }
  return `HTTP ${response.status}`
}

export class EngineRelayVoiceEngine implements VoiceEngine {
  readonly sampleRate = RELAY_SAMPLE_RATE
  readonly voiceCount = 1
  readonly #apiUrl: string
  readonly #fetch: typeof fetch

  constructor(apiUrl: string, fetchImplementation: typeof fetch = fetch) {
    this.#apiUrl = apiUrl
    this.#fetch = fetchImplementation
  }

  // The numeric voiceId knob is a sherpa concept — the provider voice is the
  // user's saved pick, applied engine-side.
  async synthesize(text: string): Promise<PcmAudio> {
    let response: Response
    try {
      response = await this.#fetch(`${this.#apiUrl}/voice/provider-synthesize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
      })
    } catch (error) {
      throw new EngineRelayUnavailableError(
        null,
        `cloud synthesis unreachable: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    if (!response.ok) {
      throw new EngineRelayUnavailableError(response.status, await describeRelayFault(response))
    }
    return decodeWavToPcm(new Uint8Array(await response.arrayBuffer()))
  }
}

export class EngineRelaySpeechRecognizer implements SpeechRecognizer {
  readonly #apiUrl: string
  readonly #fetch: typeof fetch

  constructor(apiUrl: string, fetchImplementation: typeof fetch = fetch) {
    this.#apiUrl = apiUrl
    this.#fetch = fetchImplementation
  }

  async transcribe(audio: PcmAudio): Promise<string> {
    let response: Response
    try {
      response = await this.#fetch(`${this.#apiUrl}/voice/transcribe`, {
        method: 'POST',
        headers: { 'content-type': 'audio/wav' },
        body: encodeWavFromPcm(audio),
        signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
      })
    } catch (error) {
      throw new EngineRelayUnavailableError(
        null,
        `cloud transcription unreachable: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    if (!response.ok) {
      throw new EngineRelayUnavailableError(response.status, await describeRelayFault(response))
    }
    const body = (await response.json()) as { text?: unknown }
    return typeof body.text === 'string' ? body.text : ''
  }
}
