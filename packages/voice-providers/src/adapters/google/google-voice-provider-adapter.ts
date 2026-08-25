// Google Cloud account adapter. Auth = the `x-goog-api-key` header — the
// key never rides a `?key=` query param (URLs land in logs). Verify hits
// the Text-to-Speech voices list narrowed to one language (small
// response); the full list backs the Settings picker. A key can have TTS
// enabled but not Speech-to-Text — that surfaces honestly at first
// transcription, not here.

import { ValidationError } from '@vynel/errors'
import {
  describeNetworkFault,
  describeProviderFault,
  PROVIDER_FAULT_EXCERPT_LIMIT,
} from '../describe-provider-fault.js'
import {
  VoiceProviderAdapter,
  type VerifyVoiceProviderCredentialsResult,
} from '../voice-provider-adapter.js'
import type { VoiceProviderVoice } from '@vynel/contracts/voice/voice-providers'
import type { VoiceProviderCredentials } from '../../voice-provider-types.js'

const GOOGLE_TTS_API_URL = 'https://texttospeech.googleapis.com'
const REQUEST_TIMEOUT_MS = 10_000

interface GoogleErrorResponse {
  error?: { message?: string }
}

interface GoogleVoicesResponse {
  voices?: {
    name: string
    languageCodes?: string[]
  }[]
}

export class GoogleVoiceProviderAdapter extends VoiceProviderAdapter {
  readonly providerId = 'google' as const
  readonly #fetch: typeof fetch

  constructor(fetchImplementation: typeof fetch = fetch) {
    super()
    this.#fetch = fetchImplementation
  }

  async verifyCredentials(input: {
    credentials: VoiceProviderCredentials
  }): Promise<VerifyVoiceProviderCredentialsResult> {
    let response: Response
    try {
      response = await this.#request('/v1/voices?languageCode=en-US', input.credentials)
    } catch (error) {
      return { kind: 'invalid', reasonMessage: describeNetworkFault(error) }
    }
    if (!response.ok) {
      return { kind: 'invalid', reasonMessage: await describeGoogleFault(response) }
    }
    // Google API keys carry no account identity a label could show.
    return { kind: 'valid', accountLabel: null }
  }

  async listVoices(input: {
    credentials: VoiceProviderCredentials
  }): Promise<VoiceProviderVoice[]> {
    let response: Response
    try {
      response = await this.#request('/v1/voices', input.credentials)
    } catch (error) {
      throw new ValidationError(`Could not reach Google Cloud (${describeNetworkFault(error)}).`)
    }
    if (!response.ok) {
      throw new ValidationError(
        `Google Cloud voice list failed (${await describeGoogleFault(response)}) — ` +
          'reconnect the provider in Settings → Voice if the key changed.',
      )
    }
    const body = (await response.json()) as GoogleVoicesResponse
    return (body.voices ?? []).map((voice) => ({
      id: voice.name,
      label: voice.name,
      language: voice.languageCodes?.[0] ?? null,
    }))
  }

  #request(path: string, credentials: VoiceProviderCredentials): Promise<Response> {
    return this.#fetch(`${GOOGLE_TTS_API_URL}${path}`, {
      headers: { 'x-goog-api-key': credentials.apiKey },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  }
}

// Google wraps faults as `{ error: { message } }` — surface that message
// when present, else fall back to the generic status+excerpt form.
async function describeGoogleFault(response: Response): Promise<string> {
  const fallback = response.clone()
  try {
    const body = (await response.json()) as GoogleErrorResponse
    const message = body.error?.message
    if (message) return `HTTP ${response.status}: ${message.slice(0, PROVIDER_FAULT_EXCERPT_LIMIT)}`
  } catch {
    // Non-JSON fault body — the generic path reads the clone.
  }
  return describeProviderFault(fallback)
}
