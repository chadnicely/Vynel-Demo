// The reply_to_channel op: delivers to the turn's server-stamped origin — DM
// or group, exactly where the request came from — and guards ownership +
// enabled state. Real db, never mocked.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { NotFoundError, ValidationError } from '@vynel/errors'
import { listReadyOutboundMessages, updateChannel } from '../repositories/index.js'
import { seedChannelWithAllowedSender } from '../test-support.js'
import { replyToChannelOrigin } from './reply-to-channel-origin.js'

describe('replyToChannelOrigin', () => {
  it('delivers a DM reply to the exact sender + chat context, unthreaded', async () => {
    await withTestDatabase((db) => {
      const { channel } = seedChannelWithAllowedSender(db)

      const deliveredTo = replyToChannelOrigin(db, {
        userId: channel.userId,
        origin: {
          channelId: channel.id,
          externalSenderId: '123456',
          externalChatContextId: '123456',
        },
        body: 'The supplier emailed about pricing.',
      })

      expect(deliveredTo).toBe(channel.displayName)
      const [queued] = listReadyOutboundMessages(db, {})
      expect(queued).toMatchObject({
        channelId: channel.id,
        externalRecipientId: '123456',
        externalChatContextId: '123456',
        messageBody: 'The supplier emailed about pricing.',
        payloadKind: 'chat-stream-final',
      })
      expect(JSON.parse(queued!.messageStructure)).toEqual({})
    })
  })

  it('threads a GROUP reply onto the asking message via the origin', async () => {
    await withTestDatabase((db) => {
      const { channel } = seedChannelWithAllowedSender(db)

      replyToChannelOrigin(db, {
        userId: channel.userId,
        origin: {
          channelId: channel.id,
          externalSenderId: '123456',
          externalChatContextId: '-100777',
          externalMessageId: 'msg-42',
        },
        body: 'Pricing went up 4%.',
      })

      const [queued] = listReadyOutboundMessages(db, {})
      expect(queued?.externalChatContextId).toBe('-100777')
      expect(JSON.parse(queued!.messageStructure)).toEqual({
        replyToExternalMessageId: 'msg-42',
      })
    })
  })

  it("404s a foreign or unknown channel, 400s a disabled one — never a mis-delivery", async () => {
    await withTestDatabase((db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      const origin = {
        channelId: channel.id,
        externalSenderId: '123456',
        externalChatContextId: '123456',
      }

      expect(() =>
        replyToChannelOrigin(db, { userId: randomUUID(), origin, body: 'x' }),
      ).toThrowError(NotFoundError)
      expect(() =>
        replyToChannelOrigin(db, {
          userId: channel.userId,
          origin: { ...origin, channelId: randomUUID() },
          body: 'x',
        }),
      ).toThrowError(NotFoundError)

      updateChannel(db, channel.id, { isEnabled: false })
      expect(() =>
        replyToChannelOrigin(db, { userId: channel.userId, origin, body: 'x' }),
      ).toThrowError(ValidationError)
      expect(listReadyOutboundMessages(db, {})).toHaveLength(0)
    })
  })
})
