// Integration tests for the `/voice/providers` + cloud-audio routes. Full
// HTTP stack: route -> validator -> userScoped -> leaf op -> SQLite (real,
// via withTestDatabase). The network is ONE fake fetch dispatching on URL —
// the REAL adapters and engines run against it; nothing else is mocked.

import { describe, expect, it } from 'vitest'
import { randomBytes, randomUUID } from 'node:crypto'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { decodeWavToPcm, encodeWavFromPcm } from '@vynel/voice-engine/pcm-codec'
import { createApp } from '../../../app.js'

const silentLogger = pino({ level: 'silent' })
const masterKeyBase64 = randomBytes(32).toString('base64')

function makeUser() {
  const now = new Date()
  return {
    id: randomUUID(),
    displayName: 'Dana',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  }
}

function jsonBody(method: string, payload: unknown): RequestInit {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }
}

const utteranceWav = encodeWavFromPcm({
  samples: new Float32Array([0, 0.5, -0.5, 0.25]),
  sampleRate: 16_000,
})

// One fake cloud: ElevenLabs account + voices + STT + TTS, Google voices.
// Requests carrying the wrong key answer 401 like the real services.
function fakeCloudFetch(validKey = 'xi-valid-key'): typeof fetch {
  return async (input, init) => {
    const url = String(input)
    const headers = (init?.headers ?? {}) as Record<string, string>
    const keyHeader = headers['xi-api-key'] ?? headers['x-goog-api-key']
    if (keyHeader !== validKey) return new Response('Unauthorized', { status: 401 })

    if (url === 'https://api.elevenlabs.io/v1/user') {
      return Response.json({ subscription: { tier: 'starter' } })
    }
    if (url === 'https://api.elevenlabs.io/v1/voices') {
      return Response.json({
        voices: [{ voice_id: 'v-rachel', name: 'Rachel', labels: { language: 'en' } }],
      })
    }
    if (url.startsWith('https://api.elevenlabs.io/v1/text-to-speech/')) {
      const pcmBytes = new Uint8Array(4)
      new DataView(pcmBytes.buffer).setInt16(0, 16_384, true)
      new DataView(pcmBytes.buffer).setInt16(2, -16_384, true)
      return new Response(pcmBytes, { status: 200 })
    }
    if (url === 'https://api.elevenlabs.io/v1/speech-to-text') {
      return Response.json({ text: 'hello from the cloud' })
    }
    if (url.startsWith('https://texttospeech.googleapis.com/v1/voices')) {
      return Response.json({ voices: [{ name: 'en-US-Neural2-C', languageCodes: ['en-US'] }] })
    }
    throw new Error(`fakeCloudFetch: unexpected URL ${url}`)
  }
}

function buildApp(db: Parameters<Parameters<typeof withTestDatabase>[0]>[0]) {
  return createApp({
    db,
    logger: silentLogger,
    sshMasterKeyBase64: masterKeyBase64,
    voiceProviderFetch: fakeCloudFetch(),
  })
}

describe('voice provider routes', () => {
  it('connect → list shows it connected; the key never appears in any response', async () => {
    await withTestDatabase(async (db) => {
      insertUser(db, makeUser())
      const app = buildApp(db)

      const before = await app.request('/voice/providers')
      expect(before.status).toBe(200)
      const catalog = (await before.json()) as { id: string; connected: boolean }[]
      expect(catalog.map((entry) => entry.id).sort()).toEqual(['elevenlabs', 'google'])
      expect(catalog.every((entry) => !entry.connected)).toBe(true)

      const connected = await app.request(
        '/voice/providers/elevenlabs/connect',
        jsonBody('POST', { apiKey: 'xi-valid-key' }),
      )
      expect(connected.status).toBe(200)
      const status = await connected.json()
      expect(status).toMatchObject({ id: 'elevenlabs', connected: true, accountLabel: 'starter' })
      expect(JSON.stringify(status)).not.toContain('xi-valid-key')

      const after = await app.request('/voice/providers')
      expect(JSON.stringify(await after.json())).not.toContain('xi-valid-key')
    })
  })

  it('a rejected key answers 400 and persists nothing', async () => {
    await withTestDatabase(async (db) => {
      insertUser(db, makeUser())
      const app = buildApp(db)

      const connected = await app.request(
        '/voice/providers/elevenlabs/connect',
        jsonBody('POST', { apiKey: 'wrong-key' }),
      )
      expect(connected.status).toBe(400)

      const listed = (await (await app.request('/voice/providers')).json()) as {
        connected: boolean
      }[]
      expect(listed.every((entry) => !entry.connected)).toBe(true)
    })
  })

  it('disconnect answers 204 then 404; voices answer 409 unconnected, the list when connected', async () => {
    await withTestDatabase(async (db) => {
      insertUser(db, makeUser())
      const app = buildApp(db)

      expect((await app.request('/voice/providers/google/voices')).status).toBe(409)

      await app.request('/voice/providers/google/connect', jsonBody('POST', { apiKey: 'xi-valid-key' }))
      const voices = await app.request('/voice/providers/google/voices')
      expect(voices.status).toBe(200)
      expect(await voices.json()).toEqual({
        voices: [{ id: 'en-US-Neural2-C', label: 'en-US-Neural2-C', language: 'en-US' }],
      })

      expect((await app.request('/voice/providers/google', { method: 'DELETE' })).status).toBe(204)
      expect((await app.request('/voice/providers/google', { method: 'DELETE' })).status).toBe(404)
    })
  })

  it('transcribe refuses while web-speech is the source, then transcribes through the picked provider', async () => {
    await withTestDatabase(async (db) => {
      insertUser(db, makeUser())
      const app = buildApp(db)
      const wavRequest = {
        method: 'POST',
        headers: { 'content-type': 'audio/wav' },
        body: utteranceWav,
      }

      // The default hearing source is web-speech — the cloud door is closed.
      expect((await app.request('/voice/transcribe', wavRequest)).status).toBe(409)

      await app.request(
        '/users/me/preferences',
        jsonBody('PATCH', { voiceSttSource: 'elevenlabs' }),
      )
      // Picked but not connected — still an honest 409.
      expect((await app.request('/voice/transcribe', wavRequest)).status).toBe(409)

      await app.request(
        '/voice/providers/elevenlabs/connect',
        jsonBody('POST', { apiKey: 'xi-valid-key' }),
      )
      const transcribed = await app.request('/voice/transcribe', wavRequest)
      expect(transcribed.status).toBe(200)
      expect(await transcribed.json()).toEqual({ text: 'hello from the cloud' })
    })
  })

  it('provider-synthesize walks its gates then answers decodable WAV', async () => {
    await withTestDatabase(async (db) => {
      insertUser(db, makeUser())
      const app = buildApp(db)
      const speak = jsonBody('POST', { text: 'Hello there.' })

      expect((await app.request('/voice/provider-synthesize', speak)).status).toBe(409)

      await app.request('/users/me/preferences', jsonBody('PATCH', { voiceTtsSource: 'elevenlabs' }))
      // No provider voice picked yet.
      expect((await app.request('/voice/provider-synthesize', speak)).status).toBe(409)

      await app.request(
        '/users/me/preferences',
        jsonBody('PATCH', { voiceTtsProviderVoiceId: 'v-rachel' }),
      )
      await app.request(
        '/voice/providers/elevenlabs/connect',
        jsonBody('POST', { apiKey: 'xi-valid-key' }),
      )

      const spoken = await app.request('/voice/provider-synthesize', speak)
      expect(spoken.status).toBe(200)
      expect(spoken.headers.get('content-type')).toBe('audio/wav')
      const pcm = decodeWavToPcm(new Uint8Array(await spoken.arrayBuffer()))
      expect(pcm.sampleRate).toBe(24_000)
      expect(pcm.samples[0]).toBeCloseTo(0.5, 3)
    })
  })

  it('answers 409 for every sealing door when the master key is not loaded', async () => {
    await withTestDatabase(async (db) => {
      insertUser(db, makeUser())
      const app = createApp({ db, logger: silentLogger, voiceProviderFetch: fakeCloudFetch() })

      const connected = await app.request(
        '/voice/providers/elevenlabs/connect',
        jsonBody('POST', { apiKey: 'xi-valid-key' }),
      )
      expect(connected.status).toBe(409)
    })
  })
})
