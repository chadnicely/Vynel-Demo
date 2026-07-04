import { describe, it, expect, vi, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import {
  insertOutboundMessage,
  findOutboundMessageById,
  type NewChannelMessageQueueEntry,
} from '../repositories/index.js'
import { seedChannel } from '../test-support.js'
import { runChannelDeliveryTick } from './run-channel-delivery-tick.js'
import { resolveChannelAdapter } from '../adapters/channel-adapter-registry.js'
import type { ChannelAdapter } from '../adapters/channel-adapter.js'

vi.mock('../adapters/channel-adapter-registry.js', () => ({ resolveChannelAdapter: vi.fn() }))

function makeStubAdapter(
  send: { externalSentMessageId: string } | Error,
): ChannelAdapter {
  return {
    channelKind: 'telegram',
    verifyCredentials: vi.fn(),
    pollForInboundMessages: vi.fn(),
    sendMessage:
      send instanceof Error ? vi.fn().mockRejectedValue(send) : vi.fn().mockResolvedValue(send),
    editMessage: vi.fn(),
    supportsInlineButtons: () => true,
    supportsMessageEditing: () => true,
  } as unknown as ChannelAdapter
}

function makeEntry(
  channelId: string,
  overrides: Partial<NewChannelMessageQueueEntry> = {},
): NewChannelMessageQueueEntry {
  const now = new Date()
  return {
    id: randomUUID(),
    channelId,
    externalRecipientId: '123456',
    externalChatContextId: '123456',
    messageBody: 'reply',
    messageStructure: JSON.stringify({ parseMode: 'plain' }),
    payloadKind: 'chat-stream-final',
    status: 'pending',
    statusMessage: null,
    attemptCount: 0,
    lastAttemptedAt: null,
    nextAttemptAt: now,
    externalSentMessageId: null,
    enqueuedAt: now,
    sentAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('runChannelDeliveryTick', () => {
  it('sends a ready message and marks it sent', async () => {
    vi.mocked(resolveChannelAdapter).mockReturnValue(makeStubAdapter({ externalSentMessageId: 'tg-99' }))
    await withTestDatabase(async (db) => {
      const { channel } = seedChannel(db)
      const entry = insertOutboundMessage(db, makeEntry(channel.id))
      const result = await runChannelDeliveryTick(db)
      expect(result.sentCount).toBe(1)
      const after = findOutboundMessageById(db, entry.id)
      expect(after?.status).toBe('sent')
      expect(after?.externalSentMessageId).toBe('tg-99')
    })
  })

  it('schedules a retry with backoff on a transient failure', async () => {
    vi.mocked(resolveChannelAdapter).mockReturnValue(makeStubAdapter(new Error('network blip')))
    await withTestDatabase(async (db) => {
      const { channel } = seedChannel(db)
      const entry = insertOutboundMessage(db, makeEntry(channel.id, { attemptCount: 0 }))
      const before = Date.now()
      const result = await runChannelDeliveryTick(db)
      expect(result.failedCount).toBe(0) // not given up yet
      const after = findOutboundMessageById(db, entry.id)
      expect(after?.status).toBe('failed-retry')
      expect(after?.attemptCount).toBe(1)
      expect(after?.nextAttemptAt.getTime()).toBeGreaterThan(before) // backoff into the future
    })
  })

  it('scrubs a bot-token-shaped error before storing it (no token leak)', async () => {
    const token = '123456789:AAHHfakeBotTokenValue0000000000000000'
    vi.mocked(resolveChannelAdapter).mockReturnValue(
      makeStubAdapter(new Error(`sendMessage failed: https://api.telegram.org/bot${token}/sendMessage`)),
    )
    await withTestDatabase(async (db) => {
      const { channel } = seedChannel(db)
      const entry = insertOutboundMessage(db, makeEntry(channel.id, { attemptCount: 0 }))
      await runChannelDeliveryTick(db)
      const after = findOutboundMessageById(db, entry.id)
      expect(after?.statusMessage).toContain('***')
      expect(after?.statusMessage).not.toContain(token)
    })
  })

  it('gives up after the max attempts', async () => {
    vi.mocked(resolveChannelAdapter).mockReturnValue(makeStubAdapter(new Error('revoked token')))
    await withTestDatabase(async (db) => {
      const { channel } = seedChannel(db)
      // attemptCount 5 → this attempt is the 6th (MAX) → give up.
      const entry = insertOutboundMessage(
        db,
        makeEntry(channel.id, { status: 'failed-retry', attemptCount: 5 }),
      )
      const result = await runChannelDeliveryTick(db)
      expect(result.failedCount).toBe(1)
      expect(findOutboundMessageById(db, entry.id)?.status).toBe('failed-give-up')
    })
  })

  it('skips messages for a disabled channel', async () => {
    vi.mocked(resolveChannelAdapter).mockReturnValue(makeStubAdapter({ externalSentMessageId: 'x' }))
    await withTestDatabase(async (db) => {
      const { channel } = seedChannel(db, { isEnabled: false })
      const entry = insertOutboundMessage(db, makeEntry(channel.id))
      const result = await runChannelDeliveryTick(db)
      expect(result.sentCount).toBe(0)
      expect(findOutboundMessageById(db, entry.id)?.status).toBe('pending')
    })
  })
})
