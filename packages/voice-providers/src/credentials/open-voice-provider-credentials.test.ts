import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { ValidationError } from '@vynel/errors'
import { connectVoiceProvider } from '../lifecycle/connect-voice-provider.js'
import { openVoiceProviderCredentials } from './open-voice-provider-credentials.js'
import { FakeVoiceProviderAdapter, TEST_MASTER_KEY_BASE64, makeUser } from '../test-support.js'

describe('openVoiceProviderCredentials', () => {
  it('round-trips the sealed key for server-side use', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      await connectVoiceProvider(
        db,
        { userId: user.id, provider: 'elevenlabs', credentials: { apiKey: 'xi-secret' } },
        {
          masterKeyBase64: TEST_MASTER_KEY_BASE64,
          adapter: new FakeVoiceProviderAdapter('elevenlabs'),
        },
      )

      const credentials = openVoiceProviderCredentials(
        db,
        { userId: user.id, provider: 'elevenlabs' },
        { masterKeyBase64: TEST_MASTER_KEY_BASE64 },
      )
      expect(credentials).toEqual({ apiKey: 'xi-secret' })
    })
  })

  it('returns null when the provider was never connected', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      expect(
        openVoiceProviderCredentials(
          db,
          { userId: user.id, provider: 'google' },
          { masterKeyBase64: TEST_MASTER_KEY_BASE64 },
        ),
      ).toBeNull()
    })
  })

  it('turns an unreadable blob (wrong master key) into an actionable error', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      await connectVoiceProvider(
        db,
        { userId: user.id, provider: 'elevenlabs', credentials: { apiKey: 'xi-secret' } },
        {
          masterKeyBase64: TEST_MASTER_KEY_BASE64,
          adapter: new FakeVoiceProviderAdapter('elevenlabs'),
        },
      )

      const wrongKey = Buffer.alloc(32, 9).toString('base64')
      expect(() =>
        openVoiceProviderCredentials(
          db,
          { userId: user.id, provider: 'elevenlabs' },
          { masterKeyBase64: wrongKey },
        ),
      ).toThrow(ValidationError)
    })
  })
})
