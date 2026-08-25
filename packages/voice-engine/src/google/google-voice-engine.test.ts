import { describe, it, expect } from 'vitest'
import { GoogleVoiceEngine } from './google-voice-engine.js'
import { encodeWavFromPcm } from '../pcm-codec.js'
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

function wavResponse(): Response {
  const wav = encodeWavFromPcm({ samples: new Float32Array([0, 0.5]), sampleRate: 24_000 })
  return Response.json({ audioContent: Buffer.from(wav).toString('base64') })
}

describe('GoogleVoiceEngine', () => {
  it('synthesizes LINEAR16 for the constructed voice, key in the header only', async () => {
    const seen: SeenRequest[] = []
    const engine = new GoogleVoiceEngine({
      apiKey: 'AIza-secret',
      voiceName: 'en-US-Neural2-C',
      fetchImplementation: fakeFetch(wavResponse, seen),
    })

    const audio = await engine.synthesize('Hello.')

    expect(seen[0]!.url).toBe('https://texttospeech.googleapis.com/v1/text:synthesize')
    expect(seen[0]!.url).not.toContain('AIza-secret')
    expect(seen[0]!.headers['x-goog-api-key']).toBe('AIza-secret')
    expect(JSON.parse(seen[0]!.body)).toEqual({
      input: { text: 'Hello.' },
      voice: { name: 'en-US-Neural2-C', languageCode: 'en-US' },
      audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: 24_000 },
    })
    expect(audio.sampleRate).toBe(24_000)
    expect(audio.samples[1]).toBeCloseTo(0.5, 3)
  })

  it('maps the speed knob to speakingRate and honors an explicit languageCode', async () => {
    const seen: SeenRequest[] = []
    const engine = new GoogleVoiceEngine({
      apiKey: 'AIza',
      voiceName: 'cmn-CN-Standard-A',
      languageCode: 'cmn-CN',
      fetchImplementation: fakeFetch(wavResponse, seen),
    })
    await engine.synthesize('你好', { speed: 1.2 })
    const body = JSON.parse(seen[0]!.body)
    expect(body.voice.languageCode).toBe('cmn-CN')
    expect(body.audioConfig.speakingRate).toBe(1.2)
  })

  it('an empty answer throws the typed error instead of decoding nothing', async () => {
    const engine = new GoogleVoiceEngine({
      apiKey: 'AIza',
      voiceName: 'en-US-Neural2-C',
      fetchImplementation: fakeFetch(() => Response.json({})),
    })
    await expect(engine.synthesize('Hi')).rejects.toThrow(VoiceProviderRequestError)
  })

  it('an auth fault reports isAuthFailure', async () => {
    const engine = new GoogleVoiceEngine({
      apiKey: 'bad',
      voiceName: 'en-US-Neural2-C',
      fetchImplementation: fakeFetch(() => new Response('Forbidden', { status: 403 })),
    })
    const failure = await engine.synthesize('Hi').catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(VoiceProviderRequestError)
    expect((failure as VoiceProviderRequestError).isAuthFailure).toBe(true)
  })
})
