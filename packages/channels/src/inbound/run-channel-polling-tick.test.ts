import { describe, it, expect, vi, beforeEach } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { listInboundMessagesForChannel, findChannelById } from '../repositories/index.js'
import { seedChannelWithAllowedSender } from '../test-support.js'
import { runChannelPollingTick } from './run-channel-polling-tick.js'
import { resolveChannelAdapter } from '../adapters/channel-adapter-registry.js'
import type { ChannelAdapter, NormalizedInboundMessage } from '../adapters/channel-adapter.js'

vi.mock('../adapters/channel-adapter-registry.js', () => ({ resolveChannelAdapter: vi.fn() }))

function makeStubAdapter(
  outcome: { messages: NormalizedInboundMessage[]; nextCursor: string } | Error,
): ChannelAdapter {
  return {
    channelKind: 'telegram',
    verifyCredentials: vi.fn(),
    pollForInboundMessages:
      outcome instanceof Error ? vi.fn().mockRejectedValue(outcome) : vi.fn().mockResolvedValue(outcome),
    sendMessage: vi.fn(),
    editMessage: vi.fn(),
    supportsInlineButtons: () => true,
    supportsMessageEditing: () => true,
  } as unknown as ChannelAdapter
}

function inbound(overrides: Partial<NormalizedInboundMessage> = {}): NormalizedInboundMessage {
  return {
    externalMessageId: 'm1',
    externalSenderId: '123456',
    externalSenderHandle: '@owner',
    externalSenderDisplayName: 'Owner',
    externalChatContextId: '123456',
    messageBody: 'hello',
    messageMetadata: {},
    receivedAt: new Date(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('runChannelPollingTick', () => {
  it('inserts a pending chat-turn for an allowed sender and advances the cursor', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      vi.mocked(resolveChannelAdapter).mockReturnValue(
        makeStubAdapter({
          messages: [inbound({ messageBody: 'what did the supplier email about?' })],
          nextCursor: '11',
        }),
      )
      const result = await runChannelPollingTick(db)
      expect(result.insertedMessageCount).toBe(1)
      const rows = listInboundMessagesForChannel(db, channel.id, {})
      expect(rows).toHaveLength(1)
      expect(rows[0]?.intentKind).toBe('chat-turn')
      expect(rows[0]?.status).toBe('pending')
      expect(findChannelById(db, channel.id)?.lastPolledCursor).toBe('11')
    })
  })

  it('stores a non-allowed sender as ignored', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      vi.mocked(resolveChannelAdapter).mockReturnValue(
        makeStubAdapter({
          messages: [inbound({ externalSenderId: '999', externalChatContextId: '999' })],
          nextCursor: '11',
        }),
      )
      await runChannelPollingTick(db)
      const rows = listInboundMessagesForChannel(db, channel.id, {})
      expect(rows).toHaveLength(1)
      expect(rows[0]?.status).toBe('ignored')
      expect(rows[0]?.intentKind).toBe('ignored')
    })
  })

  it('dedups by externalMessageId across ticks', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      vi.mocked(resolveChannelAdapter).mockReturnValue(
        makeStubAdapter({ messages: [inbound({ externalMessageId: 'dup' })], nextCursor: '11' }),
      )
      await runChannelPollingTick(db)
      await runChannelPollingTick(db) // same message redelivered
      expect(listInboundMessagesForChannel(db, channel.id, {})).toHaveLength(1)
    })
  })

  it('classifies slash commands and approval replies for allowed senders', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      vi.mocked(resolveChannelAdapter).mockReturnValue(
        makeStubAdapter({
          messages: [
            inbound({ externalMessageId: 'a', messageBody: '/help' }),
            inbound({ externalMessageId: 'b', messageBody: 'approve' }),
          ],
          nextCursor: '11',
        }),
      )
      await runChannelPollingTick(db)
      const byId = new Map(
        listInboundMessagesForChannel(db, channel.id, {}).map((r) => [r.externalMessageId, r.intentKind]),
      )
      expect(byId.get('a')).toBe('channel-command')
      expect(byId.get('b')).toBe('approval-reply')
    })
  })

  it('downgrades connectionStatus on a poll failure without throwing', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      vi.mocked(resolveChannelAdapter).mockReturnValue(makeStubAdapter(new Error('401: Unauthorized')))
      const result = await runChannelPollingTick(db)
      expect(result.insertedMessageCount).toBe(0)
      const updated = findChannelById(db, channel.id)
      expect(updated?.connectionStatus).toBe('auth-failed')
      expect(updated?.connectionStatusMessage).toContain('401')
    })
  })

  it('scrubs a bot-token-shaped error before storing it (no token leak)', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      const token = '123456789:AAHHfakeBotTokenValue0000000000000000'
      vi.mocked(resolveChannelAdapter).mockReturnValue(
        makeStubAdapter(new Error(`getUpdates failed: https://api.telegram.org/bot${token}/getUpdates`)),
      )
      await runChannelPollingTick(db)
      const updated = findChannelById(db, channel.id)
      expect(updated?.connectionStatusMessage).toContain('***')
      expect(updated?.connectionStatusMessage).not.toContain(token)
    })
  })
})
