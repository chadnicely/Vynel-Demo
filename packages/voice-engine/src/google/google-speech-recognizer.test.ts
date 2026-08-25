import { describe, it, expect } from 'vitest'
import { GoogleSpeechRecognizer } from './google-speech-recognizer.js'
import { decodeWavToPcm } from '../pcm-codec.js'
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

const utterance = { samples: new Float32Array([0, 0.5, -0.5]), sampleRate: 16_000 }

describe('GoogleSpeechRecognizer', () => {
  it('ships base64 WAV and lets the header declare encoding + rate', async () => {
    const seen: SeenRequest[] = []
    const recognizer = new GoogleSpeechRecognizer({
      apiKey: 'AIza-secret',
      fetchImplementation: fakeFetch(
        () => Response.json({ results: [{ alternatives: [{ transcript: 'hello world' }] }] }),
        seen,
      ),
    })

    const transcript = await recognizer.transcribe(utterance)

    expect(transcript).toBe('hello world')
    expect(seen[0]!.url).toBe('https://speech.googleapis.com/v1/speech:recognize')
    expect(seen[0]!.url).not.toContain('AIza-secret')
    expect(seen[0]!.headers['x-goog-api-key']).toBe('AIza-secret')
    const body = JSON.parse(seen[0]!.body)
    expect(body.config).toEqual({ languageCode: 'en-US', enableAutomaticPunctuation: true })
    // The WAV header is the encoding declaration — decode proves the shape.
    const wav = decodeWavToPcm(new Uint8Array(Buffer.from(body.audio.content, 'base64')))
    expect(wav.sampleRate).toBe(16_000)
    expect(wav.samples.length).toBe(utterance.samples.length)
  })

  it('joins multi-result transcripts and answers empty for silence', async () => {
    const recognizer = new GoogleSpeechRecognizer({
      apiKey: 'AIza',
      fetchImplementation: fakeFetch(() =>
        Response.json({
          results: [
            { alternatives: [{ transcript: 'first part' }] },
            { alternatives: [{ transcript: 'second part' }] },
          ],
        }),
      ),
    })
    expect(await recognizer.transcribe(utterance)).toBe('first part second part')

    const silent = new GoogleSpeechRecognizer({
      apiKey: 'AIza',
      fetchImplementation: fakeFetch(() => Response.json({})),
    })
    expect(await silent.transcribe(utterance)).toBe('')
  })

  it('a provider fault throws the typed error', async () => {
    const recognizer = new GoogleSpeechRecognizer({
      apiKey: 'AIza',
      fetchImplementation: fakeFetch(() => new Response('Bad Request', { status: 400 })),
    })
    await expect(recognizer.transcribe(utterance)).rejects.toThrow(VoiceProviderRequestError)
  })
})
