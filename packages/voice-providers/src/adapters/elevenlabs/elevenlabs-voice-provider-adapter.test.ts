import { describe, it, expect } from 'vitest'
import { ValidationError } from '@vynel/errors'
import { ElevenLabsVoiceProviderAdapter } from './elevenlabs-voice-provider-adapter.js'

interface SeenRequest {
  url: string
  headers: Record<string, string>
}

function fakeFetch(respond: (url: string) => Response, seen: SeenRequest[] = []): typeof fetch {
  return async (input, init) => {
    const url = String(input)
    seen.push({ url, headers: (init?.headers ?? {}) as Record<string, string> })
    return respond(url)
  }
}

describe('ElevenLabsVoiceProviderAdapter', () => {
  it('sends the key as the xi-api-key header, never in the URL', async () => {
    const seen: SeenRequest[] = []
    const adapter = new ElevenLabsVoiceProviderAdapter(
      fakeFetch(() => Response.json({ subscription: { tier: 'starter' } }), seen),
    )

    const verified = await adapter.verifyCredentials({ credentials: { apiKey: 'xi-secret' } })

    expect(verified).toEqual({ kind: 'valid', accountLabel: 'starter' })
    expect(seen[0]!.url).toBe('https://api.elevenlabs.io/v1/user')
    expect(seen[0]!.url).not.toContain('xi-secret')
    expect(seen[0]!.headers['xi-api-key']).toBe('xi-secret')
  })

  it('a 401 verifies as invalid with a clean reason', async () => {
    const adapter = new ElevenLabsVoiceProviderAdapter(
      fakeFetch(() => new Response('Unauthorized', { status: 401 })),
    )
    const verified = await adapter.verifyCredentials({ credentials: { apiKey: 'bad' } })
    expect(verified).toEqual({
      kind: 'invalid',
      reasonMessage: 'ElevenLabs rejected this API key',
    })
  })

  it('a network failure verifies as invalid, not a throw', async () => {
    const adapter = new ElevenLabsVoiceProviderAdapter(async () => {
      throw new Error('getaddrinfo ENOTFOUND')
    })
    const verified = await adapter.verifyCredentials({ credentials: { apiKey: 'any' } })
    expect(verified.kind).toBe('invalid')
  })

  it('maps the account voices list', async () => {
    const adapter = new ElevenLabsVoiceProviderAdapter(
      fakeFetch(() =>
        Response.json({
          voices: [
            { voice_id: 'v1', name: 'Rachel', labels: { language: 'en' } },
            { voice_id: 'v2', name: 'Antoni' },
          ],
        }),
      ),
    )
    expect(await adapter.listVoices({ credentials: { apiKey: 'xi' } })).toEqual([
      { id: 'v1', label: 'Rachel', language: 'en' },
      { id: 'v2', label: 'Antoni', language: null },
    ])
  })

  it('a rejected key at list time throws an actionable ValidationError', async () => {
    const adapter = new ElevenLabsVoiceProviderAdapter(
      fakeFetch(() => new Response('Unauthorized', { status: 401 })),
    )
    await expect(adapter.listVoices({ credentials: { apiKey: 'revoked' } })).rejects.toThrow(
      ValidationError,
    )
  })
})
