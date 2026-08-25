import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { openSecret } from '@vynel/sealing'
import { ValidationError } from '@vynel/errors'
import { connectVoiceProvider } from './connect-voice-provider.js'
import { VOICE_PROVIDER_CONNECTED } from '../voice-provider-events.js'
import { listVoiceProviderConnectionsForUser } from '../repositories/index.js'
import { FakeVoiceProviderAdapter, TEST_MASTER_KEY_BASE64, makeUser } from '../test-support.js'

describe('connectVoiceProvider', () => {
  it('verifies the key, seals it, and co-commits the connected event', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const adapter = new FakeVoiceProviderAdapter('elevenlabs', {
        kind: 'valid',
        accountLabel: 'starter',
      })

      const connection = await connectVoiceProvider(
        db,
        { userId: user.id, provider: 'elevenlabs', credentials: { apiKey: 'xi-secret-key' } },
        { masterKeyBase64: TEST_MASTER_KEY_BASE64, adapter },
      )

      expect(connection.provider).toBe('elevenlabs')
      expect(connection.accountLabel).toBe('starter')
      // Sealed at rest: the stored blob never contains the key, but opens
      // back to it with the master key.
      expect(connection.encryptedCredentials).not.toContain('xi-secret-key')
      expect(
        JSON.parse(openSecret(TEST_MASTER_KEY_BASE64, connection.encryptedCredentials)),
      ).toEqual({ apiKey: 'xi-secret-key' })

      const events = listOutboxEventsByType(db, VOICE_PROVIDER_CONNECTED)
      expect(events).toHaveLength(1)
      expect(events[0]!.payload).toEqual({
        connectionId: connection.id,
        userId: user.id,
        provider: 'elevenlabs',
        connectedAt: connection.updatedAt.toISOString(),
      })
      // The key NEVER enters a payload.
      expect(JSON.stringify(events[0]!.payload)).not.toContain('xi-secret-key')
    })
  })

  it('trims the key before verifying and sealing', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const adapter = new FakeVoiceProviderAdapter('google')

      const connection = await connectVoiceProvider(
        db,
        { userId: user.id, provider: 'google', credentials: { apiKey: '  AIza-key  ' } },
        { masterKeyBase64: TEST_MASTER_KEY_BASE64, adapter },
      )

      expect(adapter.seenCredentials).toEqual([{ apiKey: 'AIza-key' }])
      expect(
        JSON.parse(openSecret(TEST_MASTER_KEY_BASE64, connection.encryptedCredentials)),
      ).toEqual({ apiKey: 'AIza-key' })
    })
  })

  it('reconnecting the same provider rotates the key in place (one row)', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const adapter = new FakeVoiceProviderAdapter('elevenlabs')

      const first = await connectVoiceProvider(
        db,
        { userId: user.id, provider: 'elevenlabs', credentials: { apiKey: 'old-key' } },
        { masterKeyBase64: TEST_MASTER_KEY_BASE64, adapter },
      )
      const second = await connectVoiceProvider(
        db,
        { userId: user.id, provider: 'elevenlabs', credentials: { apiKey: 'new-key' } },
        { masterKeyBase64: TEST_MASTER_KEY_BASE64, adapter },
      )

      expect(second.id).toBe(first.id)
      const rows = listVoiceProviderConnectionsForUser(db, user.id)
      expect(rows).toHaveLength(1)
      expect(JSON.parse(openSecret(TEST_MASTER_KEY_BASE64, rows[0]!.encryptedCredentials))).toEqual(
        { apiKey: 'new-key' },
      )
      // Both connects are facts — reconnection fires the event again.
      expect(listOutboxEventsByType(db, VOICE_PROVIDER_CONNECTED)).toHaveLength(2)
    })
  })

  it('throws ValidationError and persists nothing when the provider rejects the key', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const adapter = new FakeVoiceProviderAdapter('elevenlabs', {
        kind: 'invalid',
        reasonMessage: 'ElevenLabs rejected this API key',
      })

      await expect(
        connectVoiceProvider(
          db,
          { userId: user.id, provider: 'elevenlabs', credentials: { apiKey: 'bad-key' } },
          { masterKeyBase64: TEST_MASTER_KEY_BASE64, adapter },
        ),
      ).rejects.toThrow(ValidationError)

      expect(listVoiceProviderConnectionsForUser(db, user.id)).toHaveLength(0)
      expect(listOutboxEventsByType(db, VOICE_PROVIDER_CONNECTED)).toHaveLength(0)
    })
  })

  it('refuses a mis-paired adapter loudly (programmer error, nothing persisted)', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const adapter = new FakeVoiceProviderAdapter('google')

      await expect(
        connectVoiceProvider(
          db,
          { userId: user.id, provider: 'elevenlabs', credentials: { apiKey: 'xi-key' } },
          { masterKeyBase64: TEST_MASTER_KEY_BASE64, adapter },
        ),
      ).rejects.toThrow('a google adapter cannot connect elevenlabs')
      expect(adapter.seenCredentials).toHaveLength(0)
      expect(listVoiceProviderConnectionsForUser(db, user.id)).toHaveLength(0)
    })
  })

  it('rejects an empty key without touching the network', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const adapter = new FakeVoiceProviderAdapter('elevenlabs')

      await expect(
        connectVoiceProvider(
          db,
          { userId: user.id, provider: 'elevenlabs', credentials: { apiKey: '   ' } },
          { masterKeyBase64: TEST_MASTER_KEY_BASE64, adapter },
        ),
      ).rejects.toThrow(ValidationError)
      expect(adapter.seenCredentials).toHaveLength(0)
    })
  })
})
