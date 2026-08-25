import { describe, it, expect } from 'vitest'
import { ValidationError } from '@vynel/errors'
import { GoogleVoiceProviderAdapter } from './google-voice-provider-adapter.js'

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

describe('GoogleVoiceProviderAdapter', () => {
  it('sends the key as the x-goog-api-key header, never a ?key= param', async () => {
    const seen: SeenRequest[] = []
    const adapter = new GoogleVoiceProviderAdapter(fakeFetch(() => Response.json({ voices: [] }), seen))

    const verified = await adapter.verifyCredentials({ credentials: { apiKey: 'AIza-secret' } })

    expect(verified).toEqual({ kind: 'valid', accountLabel: null })
    expect(seen[0]!.url).toBe('https://texttospeech.googleapis.com/v1/voices?languageCode=en-US')
    expect(seen[0]!.url).not.toContain('AIza-secret')
    expect(seen[0]!.headers['x-goog-api-key']).toBe('AIza-secret')
  })

  it("surfaces Google's own error message on an invalid key", async () => {
    const adapter = new GoogleVoiceProviderAdapter(
      fakeFetch(
        () =>
          new Response(JSON.stringify({ error: { message: 'API key not valid.' } }), {
            status: 403,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    )
    const verified = await adapter.verifyCredentials({ credentials: { apiKey: 'bad' } })
    expect(verified).toEqual({
      kind: 'invalid',
      reasonMessage: 'HTTP 403: API key not valid.',
    })
  })

  it('maps the global voices list with its language codes', async () => {
    const adapter = new GoogleVoiceProviderAdapter(
      fakeFetch(() =>
        Response.json({
          voices: [
            { name: 'en-US-Neural2-C', languageCodes: ['en-US'] },
            { name: 'fr-FR-Standard-A', languageCodes: ['fr-FR'] },
            { name: 'mystery-voice' },
          ],
        }),
      ),
    )
    expect(await adapter.listVoices({ credentials: { apiKey: 'AIza' } })).toEqual([
      { id: 'en-US-Neural2-C', label: 'en-US-Neural2-C', language: 'en-US' },
      { id: 'fr-FR-Standard-A', label: 'fr-FR-Standard-A', language: 'fr-FR' },
      { id: 'mystery-voice', label: 'mystery-voice', language: null },
    ])
  })

  it('a fault at list time throws an actionable ValidationError', async () => {
    const adapter = new GoogleVoiceProviderAdapter(
      fakeFetch(() => new Response('Forbidden', { status: 403 })),
    )
    await expect(adapter.listVoices({ credentials: { apiKey: 'revoked' } })).rejects.toThrow(
      ValidationError,
    )
  })
})
