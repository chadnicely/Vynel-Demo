import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { listReadyOutboundMessages, updateChannel } from '../repositories/index.js'
import { seedChannel, seedChannelWithAllowedSender } from '../test-support.js'
import {
  enqueueMissedScheduleChannelNotice,
  type MissedScheduleChannelNoticeInput,
} from './enqueue-missed-schedule-channel-notice.js'

function input(
  overrides: Partial<MissedScheduleChannelNoticeInput>,
): MissedScheduleChannelNoticeInput {
  return {
    channelId: 'chan-1',
    scheduleDisplayName: 'Morning brief',
    missedAtLocal: 'Aug 21, 2026, 8:00 AM',
    nextFireAtLocal: 'Aug 22, 2026, 8:00 AM',
    ...overrides,
  }
}

describe('enqueueMissedScheduleChannelNotice', () => {
  it('enqueues the shared notice wording to the channel owner', async () => {
    await withTestDatabase(async (db) => {
      const { channel, sender } = seedChannelWithAllowedSender(db)
      enqueueMissedScheduleChannelNotice(db, input({ channelId: channel.id }))

      const queued = listReadyOutboundMessages(db, {})
      expect(queued).toHaveLength(1)
      expect(queued[0]?.payloadKind).toBe('scheduled-message')
      expect(queued[0]?.externalRecipientId).toBe(sender.externalSenderId)
      expect(queued[0]?.messageBody).toBe(
        '📅 Schedule · Morning brief missed its Aug 21, 2026, 8:00 AM run ' +
          '(Vynel was not running); next run Aug 22, 2026, 8:00 AM',
      )
    })
  })

  it('drops quietly for a disabled, allowlist-less or missing channel', async () => {
    await withTestDatabase(async (db) => {
      const disabled = seedChannelWithAllowedSender(db)
      updateChannel(db, disabled.channel.id, { isEnabled: false })
      enqueueMissedScheduleChannelNotice(db, input({ channelId: disabled.channel.id }))

      const { channel: noSenders } = seedChannel(db)
      enqueueMissedScheduleChannelNotice(db, input({ channelId: noSenders.id }))

      enqueueMissedScheduleChannelNotice(db, input({ channelId: 'nonexistent' }))

      expect(listReadyOutboundMessages(db, {})).toHaveLength(0)
    })
  })
})
