import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { listReadyOutboundMessages, updateChannel } from '../repositories/index.js'
import { NotFoundError, ValidationError } from '@vynel/errors'
import { seedChannel, seedChannelWithAllowedSender } from '../test-support.js'
import { sendToChannel } from './send-to-channel.js'

describe('sendToChannel', () => {
  it('enqueues a message to the channel owner', async () => {
    await withTestDatabase(async (db) => {
      const { channel, user, sender } = seedChannelWithAllowedSender(db)
      sendToChannel(db, { userId: user.id, channelId: channel.id, body: 'The report is ready.' })
      const queued = listReadyOutboundMessages(db, {})
      expect(queued).toHaveLength(1)
      expect(queued[0]?.channelId).toBe(channel.id)
      expect(queued[0]?.externalRecipientId).toBe(sender.externalSenderId)
      expect(queued[0]?.messageBody).toBe('The report is ready.')
      expect(queued[0]?.payloadKind).toBe('chat-stream-final')
    })
  })

  it('throws NotFoundError when the channel is owned by a different user (no enumeration)', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      expect(() =>
        sendToChannel(db, { userId: 'a-different-user', channelId: channel.id, body: 'hi' }),
      ).toThrow(NotFoundError)
      expect(listReadyOutboundMessages(db, {})).toHaveLength(0)
    })
  })

  it('throws NotFoundError when the channel does not exist', async () => {
    await withTestDatabase(async (db) => {
      const { user } = seedChannelWithAllowedSender(db)
      expect(() =>
        sendToChannel(db, { userId: user.id, channelId: 'nonexistent', body: 'hi' }),
      ).toThrow(NotFoundError)
    })
  })

  it('throws ValidationError when the channel is disabled', async () => {
    await withTestDatabase(async (db) => {
      const { channel, user } = seedChannelWithAllowedSender(db)
      updateChannel(db, channel.id, { isEnabled: false })
      expect(() =>
        sendToChannel(db, { userId: user.id, channelId: channel.id, body: 'hi' }),
      ).toThrow(ValidationError)
    })
  })

  it('throws ValidationError when the channel has no allowed recipient', async () => {
    await withTestDatabase(async (db) => {
      const { channel, user } = seedChannel(db) // no allowlist
      expect(() =>
        sendToChannel(db, { userId: user.id, channelId: channel.id, body: 'hi' }),
      ).toThrow(ValidationError)
    })
  })
})
