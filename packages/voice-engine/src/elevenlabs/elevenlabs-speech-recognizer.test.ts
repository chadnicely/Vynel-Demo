import { describe, it, expect } from 'vitest'
import { ElevenLabsSpeechRecognizer } from './elevenlabs-speech-recognizer.js'
import { VoiceProviderRequestError } from '../voice-provider-request-error.js'

interface SeenRequest {
  url: string
  headers: Record<string, string>
  form: FormData
}

function fakeFetch(respond: () => Response, seen: SeenRequest[] = []): typeof fetch {
  return async (input, init) => {
    seen.push({
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
      form: init?.body as FormData,
    })
    return respond()
  }
}

const utterance = { samples: new Float32Array([0, 0.5, -0.5]), sampleRate: 16_000 }

describe('ElevenLabsSpeechRecognizer', () => {
  it('uploads the utterance as multipart WAV with the scribe model', async () => {
    const seen: SeenRequest[] = []
    const recognizer = new ElevenLabsSpeechRecognizer({
      apiKey: 'xi-secret',
      fetchImplementation: fakeFetch(() => Response.json({ text: 'hello world' }), seen),
    })

    const transcript = await recognizer.transcribe(utterance)

    expect(transcript).toBe('hello world')
    expect(seen[0]!.url).toBe('https://api.elevenlabs.io/v1/speech-to-text')
    expect(seen[0]!.headers['xi-api-key']).toBe('xi-secret')
    expect(seen[0]!.form.get('model_id')).toBe('scribe_v2')
    const file = seen[0]!.form.get('file') as Blob
    expect(file.type).toBe('audio/wav')
    expect(file.size).toBe(44 + utterance.samples.length * 2)
  })

  it('pins the language only when asked', async () => {
    const seen: SeenRequest[] = []
    const recognizer = new ElevenLabsSpeechRecognizer({
      apiKey: 'xi',
      languageCode: 'en',
      fetchImplementation: fakeFetch(() => Response.json({ text: '' }), seen),
    })
    await recognizer.transcribe(utterance)
    expect(seen[0]!.form.get('language_code')).toBe('en')
  })

  it('a missing text field answers the contract empty string', async () => {
    const recognizer = new ElevenLabsSpeechRecognizer({
      apiKey: 'xi',
      fetchImplementation: fakeFetch(() => Response.json({ words: [] })),
    })
    expect(await recognizer.transcribe(utterance)).toBe('')
  })

  it('a provider fault throws the typed error', async () => {
    const recognizer = new ElevenLabsSpeechRecognizer({
      apiKey: 'xi',
      fetchImplementation: fakeFetch(() => new Response('overloaded', { status: 503 })),
    })
    await expect(recognizer.transcribe(utterance)).rejects.toThrow(VoiceProviderRequestError)
  })
})
