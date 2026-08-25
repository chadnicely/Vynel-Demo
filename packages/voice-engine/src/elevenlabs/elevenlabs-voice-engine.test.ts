import { describe, it, expect } from 'vitest'
import { ElevenLabsVoiceEngine } from './elevenlabs-voice-engine.js'
import { VoiceProviderRequestError } from '../voice-provider-request-error.js'

interface SeenRequest {
  url: string
  headers: Record<string, string>
  body: string
}

function fakeFetch(respond: () => Response, seen: SeenRequest[] = []): typeof fetch {
  return async (input, init) => {
    seen.push({
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: String(init?.body ?? ''),
    })
    return respond()
  }
}

function rawPcmResponse(int16Values: number[]): Response {
  const bytes = new Uint8Array(int16Values.length * 2)
  const view = new DataView(bytes.buffer)
  int16Values.forEach((value, index) => view.setInt16(index * 2, value, true))
  return new Response(bytes, { status: 200 })
}

describe('ElevenLabsVoiceEngine', () => {
  it('requests pcm_24000 for the constructed voice, key in the header only', async () => {
    const seen: SeenRequest[] = []
    const engine = new ElevenLabsVoiceEngine({
      apiKey: 'xi-secret',
      voiceId: 'voice-abc',
      fetchImplementation: fakeFetch(() => rawPcmResponse([0, 16_384, -32_768]), seen),
    })

    const audio = await engine.synthesize('Hello there.')

    expect(seen[0]!.url).toBe(
      'https://api.elevenlabs.io/v1/text-to-speech/voice-abc?output_format=pcm_24000',
    )
    expect(seen[0]!.url).not.toContain('xi-secret')
    expect(seen[0]!.headers['xi-api-key']).toBe('xi-secret')
    expect(JSON.parse(seen[0]!.body)).toEqual({
      text: 'Hello there.',
      model_id: 'eleven_multilingual_v2',
    })
    expect(audio.sampleRate).toBe(24_000)
    expect(audio.samples[1]).toBeCloseTo(0.5, 3)
    expect(audio.samples[2]).toBe(-1)
  })

  it('maps the speed knob to voice_settings', async () => {
    const seen: SeenRequest[] = []
    const engine = new ElevenLabsVoiceEngine({
      apiKey: 'xi',
      voiceId: 'v',
      fetchImplementation: fakeFetch(() => rawPcmResponse([0]), seen),
    })
    await engine.synthesize('Quick.', { speed: 1.1 })
    expect(JSON.parse(seen[0]!.body).voice_settings).toEqual({ speed: 1.1 })
  })

  it('an auth fault throws a VoiceProviderRequestError that says so', async () => {
    const engine = new ElevenLabsVoiceEngine({
      apiKey: 'revoked',
      voiceId: 'v',
      fetchImplementation: fakeFetch(() => new Response('Unauthorized', { status: 401 })),
    })
    const failure = await engine.synthesize('Hi').catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(VoiceProviderRequestError)
    expect((failure as VoiceProviderRequestError).provider).toBe('elevenlabs')
    expect((failure as VoiceProviderRequestError).isAuthFailure).toBe(true)
  })

  it('a network failure throws with status null (provider down, not auth)', async () => {
    const engine = new ElevenLabsVoiceEngine({
      apiKey: 'xi',
      voiceId: 'v',
      fetchImplementation: async () => {
        throw new Error('socket hang up')
      },
    })
    const failure = await engine.synthesize('Hi').catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(VoiceProviderRequestError)
    expect((failure as VoiceProviderRequestError).status).toBeNull()
    expect((failure as VoiceProviderRequestError).isAuthFailure).toBe(false)
  })
})
