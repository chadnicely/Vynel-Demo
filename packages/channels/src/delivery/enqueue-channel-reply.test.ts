// Unit test for enqueueChannelReply (Ch4) — the reply is addressed to WHO asked
// (externalRecipientId) in the conversation they asked from (externalChatContextId).
// Distinct sender/chat values (the integration test uses equal ones) pin the mapping.

import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { listReadyOutboundMessages } from '../repositories/index.js'
import { seedChannel } from '../test-support.js'
import { enqueueChannelReply } from './enqueue-channel-reply.js'

describe('enqueueChannelReply', () => {
  it('queues a plain-text reply addressed to the sender + their chat context', async () => {
    await withTestDatabase((db) => {
      const { channel } = seedChannel(db)

      enqueueChannelReply(db, {
        channel,
        message: { externalSenderId: 'tg-42', externalChatContextId: 'chat-7' },
        body: 'here you go',
      })

      const queued = listReadyOutboundMessages(db, {})
      expect(queued).toHaveLength(1)
      expect(queued[0]).toMatchObject({
        channelId: channel.id,
        externalRecipientId: 'tg-42',
        externalChatContextId: 'chat-7',
        messageBody: 'here you go',
        payloadKind: 'chat-stream-final',
        status: 'pending',
      })
    })
  })
})
