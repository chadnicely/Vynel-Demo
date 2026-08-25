import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { NotFoundError } from '@vynel/errors'
import { connectVoiceProvider } from './connect-voice-provider.js'
import { disconnectVoiceProvider } from './disconnect-voice-provider.js'
import { VOICE_PROVIDER_DISCONNECTED } from '../voice-provider-events.js'
import { listVoiceProviderConnectionsForUser } from '../repositories/index.js'
import { FakeVoiceProviderAdapter, TEST_MASTER_KEY_BASE64, makeUser } from '../test-support.js'

describe('disconnectVoiceProvider', () => {
  it('hard-deletes the row and co-commits the disconnected event', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const connection = await connectVoiceProvider(
        db,
        { userId: user.id, provider: 'google', credentials: { apiKey: 'AIza-key' } },
        { masterKeyBase64: TEST_MASTER_KEY_BASE64, adapter: new FakeVoiceProviderAdapter('google') },
      )

      disconnectVoiceProvider(db, { userId: user.id, provider: 'google' })

      expect(listVoiceProviderConnectionsForUser(db, user.id)).toHaveLength(0)
      const events = listOutboxEventsByType(db, VOICE_PROVIDER_DISCONNECTED)
      expect(events).toHaveLength(1)
      expect(events[0]!.payload).toMatchObject({
        connectionId: connection.id,
        userId: user.id,
        provider: 'google',
      })
    })
  })

  it('throws NotFoundError when there is nothing to disconnect', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      expect(() => disconnectVoiceProvider(db, { userId: user.id, provider: 'elevenlabs' })).toThrow(
        NotFoundError,
      )
    })
  })
})
