import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { listReadyOutboundMessages, updateChannel } from '../repositories/index.js'
import { seedChannel, seedChannelWithAllowedSender } from '../test-support.js'
import {
  consumeScheduleRunCompletedEvent,
  type ScheduleRunCompletedPayload,
} from './consume-schedule-run-completed-event.js'

function payload(overrides: Partial<ScheduleRunCompletedPayload>): ScheduleRunCompletedPayload {
  return {
    scheduleId: 'sched-1',
    userId: 'user-1',
    workspaceId: 'ws-1',
    channelId: 'chan-1',
    chatSessionId: 'sess-1',
    renderedOutput: '📅 Your morning briefing: 3 emails need replies.',
    firedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('consumeScheduleRunCompletedEvent', () => {
  it('enqueues a scheduled-message to the channel owner', async () => {
    await withTestDatabase(async (db) => {
      const { channel, sender } = seedChannelWithAllowedSender(db)
      consumeScheduleRunCompletedEvent(db, payload({ channelId: channel.id }))
      const queued = listReadyOutboundMessages(db, {})
      expect(queued).toHaveLength(1)
      expect(queued[0]?.payloadKind).toBe('scheduled-message')
      expect(queued[0]?.externalRecipientId).toBe(sender.externalSenderId)
      expect(queued[0]?.messageBody).toContain('morning briefing')
    })
  })

  it('drops quietly when the channel is disabled', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      updateChannel(db, channel.id, { isEnabled: false })
      consumeScheduleRunCompletedEvent(db, payload({ channelId: channel.id }))
      expect(listReadyOutboundMessages(db, {})).toHaveLength(0)
    })
  })

  it('drops quietly when the channel has no allowed sender', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannel(db) // no allowlist
      consumeScheduleRunCompletedEvent(db, payload({ channelId: channel.id }))
      expect(listReadyOutboundMessages(db, {})).toHaveLength(0)
    })
  })

  it('drops quietly when the channel does not exist', async () => {
    await withTestDatabase(async (db) => {
      consumeScheduleRunCompletedEvent(db, payload({ channelId: 'nonexistent' }))
      expect(listReadyOutboundMessages(db, {})).toHaveLength(0)
    })
  })
})
