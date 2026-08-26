import { describe, expect, it } from 'vitest'
import { encodeWavFromPcm } from '@vynel/voice-engine/pcm-codec'
import {
  EngineRelaySpeechRecognizer,
  EngineRelayUnavailableError,
  EngineRelayVoiceEngine,
} from './engine-relay-engines.js'

interface SeenRequest {
  url: string
  headers: Record<string, string>
  body: unknown
}

function fakeFetch(respond: () => Response, seen: SeenRequest[] = []): typeof fetch {
  return (async (input: unknown, init?: RequestInit) => {
    seen.push({
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body,
    })
    return respond()
  }) as typeof fetch
}

describe('EngineRelayVoiceEngine', () => {
  it('fetches WAV from the engine door and decodes it — no credential anywhere', async () => {
    const seen: SeenRequest[] = []
    const wav = encodeWavFromPcm({ samples: new Float32Array([0, 0.5]), sampleRate: 24_000 })
    const engine = new EngineRelayVoiceEngine(
      'http://127.0.0.1:18892',
      fakeFetch(() => new Response(wav, { status: 200 }), seen),
    )

    const audio = await engine.synthesize('Hello.')

    expect(seen[0]!.url).toBe('http://127.0.0.1:18892/api/voice/provider-synthesize')
    expect(JSON.parse(String(seen[0]!.body))).toEqual({ text: 'Hello.' })
    expect(Object.keys(seen[0]!.headers)).toEqual(['content-type'])
    expect(audio.sampleRate).toBe(24_000)
    expect(audio.samples[1]).toBeCloseTo(0.5, 3)
  })

  it("surfaces the engine's fault as the typed error (the fallback voice's cue)", async () => {
    const engine = new EngineRelayVoiceEngine(
      'http://127.0.0.1:18892',
      fakeFetch(
        () =>
          new Response(JSON.stringify({ error: { message: 'ElevenLabs is unavailable' } }), {
            status: 409,
          }),
      ),
    )
    const failure = await engine.synthesize('Hi').catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(EngineRelayUnavailableError)
    expect((failure as EngineRelayUnavailableError).status).toBe(409)
    expect((failure as EngineRelayUnavailableError).message).toBe('ElevenLabs is unavailable')
  })
})

describe('EngineRelaySpeechRecognizer', () => {
  it('ships the utterance as WAV and answers the transcript', async () => {
    const seen: SeenRequest[] = []
    const recognizer = new EngineRelaySpeechRecognizer(
      'http://127.0.0.1:18892',
      fakeFetch(() => Response.json({ text: 'hello world' }), seen),
    )

    const transcript = await recognizer.transcribe({
      samples: new Float32Array([0, 0.25]),
      sampleRate: 16_000,
    })

    expect(transcript).toBe('hello world')
    expect(seen[0]!.url).toBe('http://127.0.0.1:18892/api/voice/transcribe')
    expect(seen[0]!.headers['content-type']).toBe('audio/wav')
    expect((seen[0]!.body as Uint8Array).byteLength).toBe(44 + 4)
  })

  it('an unreachable engine throws with status null', async () => {
    const recognizer = new EngineRelaySpeechRecognizer('http://127.0.0.1:18892', (async () => {
      throw new Error('ECONNREFUSED')
    }) as typeof fetch)
    const failure = await recognizer
      .transcribe({ samples: new Float32Array([0]), sampleRate: 16_000 })
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(EngineRelayUnavailableError)
    expect((failure as EngineRelayUnavailableError).status).toBeNull()
  })
})
