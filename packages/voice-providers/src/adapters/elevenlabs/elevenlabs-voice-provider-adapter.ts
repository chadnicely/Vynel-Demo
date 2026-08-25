// ElevenLabs account adapter. Auth = the `xi-api-key` header — the key
// never rides a URL (URLs land in logs). Verify reads `/v1/user` (cheap,
// and its subscription tier makes a friendly account label); voices come
// from `/v1/voices` (account-scoped, roughly a dozen entries).

import { ValidationError } from '@vynel/errors'
import { describeNetworkFault, describeProviderFault } from '../describe-provider-fault.js'
import {
  VoiceProviderAdapter,
  type VerifyVoiceProviderCredentialsResult,
} from '../voice-provider-adapter.js'
import type { VoiceProviderVoice } from '@vynel/contracts/voice/voice-providers'
import type { VoiceProviderCredentials } from '../../voice-provider-types.js'

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io'
const REQUEST_TIMEOUT_MS = 10_000

interface ElevenLabsUserResponse {
  subscription?: { tier?: string }
}

interface ElevenLabsVoicesResponse {
  voices?: {
    voice_id: string
    name: string
    labels?: Record<string, string>
  }[]
}

export class ElevenLabsVoiceProviderAdapter extends VoiceProviderAdapter {
  readonly providerId = 'elevenlabs' as const
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
      response = await this.#request('/v1/user', input.credentials)
    } catch (error) {
      return { kind: 'invalid', reasonMessage: describeNetworkFault(error) }
    }
    if (response.status === 401 || response.status === 403) {
      return { kind: 'invalid', reasonMessage: 'ElevenLabs rejected this API key' }
    }
    if (!response.ok) {
      return { kind: 'invalid', reasonMessage: await describeProviderFault(response) }
    }
    const user = (await response.json()) as ElevenLabsUserResponse
    return { kind: 'valid', accountLabel: user.subscription?.tier ?? null }
  }

  async listVoices(input: {
    credentials: VoiceProviderCredentials
  }): Promise<VoiceProviderVoice[]> {
    let response: Response
    try {
      response = await this.#request('/v1/voices', input.credentials)
    } catch (error) {
      throw new ValidationError(`Could not reach ElevenLabs (${describeNetworkFault(error)}).`)
    }
    if (response.status === 401 || response.status === 403) {
      throw new ValidationError(
        'ElevenLabs rejected the stored API key — reconnect the provider in Settings → Voice.',
      )
    }
    if (!response.ok) {
      throw new ValidationError(
        `ElevenLabs voice list failed (${await describeProviderFault(response)}).`,
      )
    }
    const body = (await response.json()) as ElevenLabsVoicesResponse
    return (body.voices ?? []).map((voice) => ({
      id: voice.voice_id,
      label: voice.name,
      language: voice.labels?.language ?? null,
    }))
  }

  #request(path: string, credentials: VoiceProviderCredentials): Promise<Response> {
    return this.#fetch(`${ELEVENLABS_API_URL}${path}`, {
      headers: { 'xi-api-key': credentials.apiKey },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  }
}
