// The shared push home's own tests: the row shape both schedule legs inherit,
// and the three quiet drops. The callers' tests assert their WORDS; this one
// asserts the shape, so a column added here is checked in exactly one place.

import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { listReadyOutboundMessages, updateChannel } from '../repositories/index.js'
import { seedChannel, seedChannelWithAllowedSender } from '../test-support.js'
import { enqueueSchedulePushToChannel } from './enqueue-schedule-push-to-channel.js'

describe('enqueueSchedulePushToChannel', () => {
  it('queues the body to the channel owner as a pending scheduled-message', async () => {
    await withTestDatabase(async (db) => {
      const { channel, sender } = seedChannelWithAllowedSender(db)

      enqueueSchedulePushToChannel(db, { channelId: channel.id, messageBody: 'the words' })

      const [queued] = listReadyOutboundMessages(db, {})
      expect(queued).toBeDefined()
      expect(queued?.channelId).toBe(channel.id)
      expect(queued?.messageBody).toBe('the words')
      expect(queued?.payloadKind).toBe('scheduled-message')
      expect(queued?.status).toBe('pending')
      expect(queued?.externalRecipientId).toBe(sender.externalSenderId)
      expect(queued?.externalChatContextId).toBe(sender.scopeContextId)
      expect(queued?.messageStructure).toBe(JSON.stringify({ parseMode: 'plain' }))
      expect(queued?.attemptCount).toBe(0)
      expect(queued?.sentAt).toBeNull()
      // The retry clock opens the instant the row is enqueued — one `now` for
      // both columns, so the push is ready on the very next delivery tick.
      expect(queued?.nextAttemptAt.getTime()).toBe(queued?.enqueuedAt.getTime())
    })
  })

  it('drops quietly for a disabled, allowlist-less or missing channel', async () => {
    await withTestDatabase(async (db) => {
      const disabled = seedChannelWithAllowedSender(db)
      updateChannel(db, disabled.channel.id, { isEnabled: false })
      enqueueSchedulePushToChannel(db, {
        channelId: disabled.channel.id,
        messageBody: 'the words',
      })

      const { channel: noSenders } = seedChannel(db)
      enqueueSchedulePushToChannel(db, { channelId: noSenders.id, messageBody: 'the words' })

      enqueueSchedulePushToChannel(db, { channelId: 'nonexistent', messageBody: 'the words' })

      expect(listReadyOutboundMessages(db, {})).toHaveLength(0)
    })
  })
})
