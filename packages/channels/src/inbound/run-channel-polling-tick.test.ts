import { describe, it, expect, vi, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import {
  listInboundMessagesForChannel,
  findChannelById,
  findChannelChatGroup,
  listChannelChatGroups,
  insertChannelChatGroup,
  insertAllowedSender,
  type Channel,
  type ChannelGroupStatus,
  type ChannelGroupMemberPolicy,
} from '../repositories/index.js'
import { seedChannelWithAllowedSender } from '../test-support.js'
import { runChannelPollingTick } from './run-channel-polling-tick.js'
import { resolveChannelAdapter } from '../adapters/channel-adapter-registry.js'
import { CHANNEL_GROUP_DISCOVERED } from '../channels-events.js'
import type { Database } from '@vynel/db'
import type { ChannelAdapter, NormalizedInboundMessage } from '../adapters/channel-adapter.js'

vi.mock('../adapters/channel-adapter-registry.js', () => ({ resolveChannelAdapter: vi.fn() }))

function makeStubAdapter(
  outcome:
    | {
        messages: NormalizedInboundMessage[]
        nextCursor: string
        groupSightings?: { externalChatContextId: string; chatContextTitle: string | null }[]
      }
    | Error,
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
    chatContextKind: 'dm',
    chatContextTitle: null,
    isBotMentioned: true,
    messageBody: 'hello',
    messageMetadata: {},
    receivedAt: new Date(),
    ...overrides,
  }
}

// A message from inside a group room (chat context ≠ sender id).
function groupInbound(overrides: Partial<NormalizedInboundMessage> = {}): NormalizedInboundMessage {
  return inbound({
    externalChatContextId: '-100777',
    chatContextKind: 'group',
    chatContextTitle: 'Marketing Team',
    isBotMentioned: true,
    ...overrides,
  })
}

function seedGroup(
  db: Database,
  channel: Channel,
  overrides: {
    status?: ChannelGroupStatus
    memberPolicy?: ChannelGroupMemberPolicy
    title?: string
  } = {},
) {
  return insertChannelChatGroup(db, {
    id: randomUUID(),
    channelId: channel.id,
    externalChatContextId: '-100777',
    title: overrides.title ?? 'Marketing Team',
    status: overrides.status ?? 'approved',
    memberPolicy: overrides.memberPolicy ?? 'everyone',
    firstSeenAt: new Date(),
    lastInboundAt: null,
    approvedAt: null,
  })
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

  it('records an unknown group as pending (+ discovery event) and enqueues NOTHING', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      vi.mocked(resolveChannelAdapter).mockReturnValue(
        makeStubAdapter({ messages: [groupInbound()], nextCursor: '11' }),
      )
      const result = await runChannelPollingTick(db)

      expect(result.insertedMessageCount).toBe(0)
      expect(listInboundMessagesForChannel(db, channel.id, {})).toHaveLength(0)

      const group = findChannelChatGroup(db, {
        channelId: channel.id,
        externalChatContextId: '-100777',
      })
      expect(group?.status).toBe('pending')
      expect(group?.memberPolicy).toBe('everyone')
      expect(group?.title).toBe('Marketing Team')

      const events = listOutboxEventsByType(db, CHANNEL_GROUP_DISCOVERED)
      expect(events).toHaveLength(1)
      expect((events[0]!.payload as { groupId: string }).groupId).toBe(group?.id)
      // The seeded bot token NEVER enters a payload.
      expect(JSON.stringify(events[0]!.payload)).not.toContain('secret-token')
    })
  })

  it('never duplicates a group row across ticks, and keeps skipping while pending', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      vi.mocked(resolveChannelAdapter).mockReturnValue(
        makeStubAdapter({
          messages: [groupInbound({ externalMessageId: 'g2' })],
          nextCursor: '12',
        }),
      )
      await runChannelPollingTick(db)
      await runChannelPollingTick(db)

      expect(listChannelChatGroups(db, channel.id)).toHaveLength(1)
      expect(listInboundMessagesForChannel(db, channel.id, {})).toHaveLength(0)
      expect(listOutboxEventsByType(db, CHANNEL_GROUP_DISCOVERED)).toHaveLength(1)
    })
  })

  it('a bot-added SIGHTING discovers the group without any message (privacy-mode path)', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      vi.mocked(resolveChannelAdapter).mockReturnValue(
        makeStubAdapter({
          messages: [],
          nextCursor: '20',
          groupSightings: [
            { externalChatContextId: '-100777', chatContextTitle: 'Marketing Team' },
          ],
        }),
      )
      await runChannelPollingTick(db)

      const group = findChannelChatGroup(db, {
        channelId: channel.id,
        externalChatContextId: '-100777',
      })
      expect(group?.status).toBe('pending')
      expect(group?.title).toBe('Marketing Team')
      expect(listOutboxEventsByType(db, CHANNEL_GROUP_DISCOVERED)).toHaveLength(1)
      // A repeat sighting (bot promoted to admin, tick overlap) never duplicates.
      await runChannelPollingTick(db)
      expect(listChannelChatGroups(db, channel.id)).toHaveLength(1)
      expect(listOutboxEventsByType(db, CHANNEL_GROUP_DISCOVERED)).toHaveLength(1)
    })
  })

  it("an approved 'everyone' group routes MENTIONED messages and skips room chatter", async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      seedGroup(db, channel, { status: 'approved', memberPolicy: 'everyone' })
      vi.mocked(resolveChannelAdapter).mockReturnValue(
        makeStubAdapter({
          messages: [
            // A stranger (not on any allowlist) mentioning the bot — the
            // room's approval is the permission under 'everyone'.
            groupInbound({ externalMessageId: 'g-hit', externalSenderId: '999' }),
            groupInbound({ externalMessageId: 'g-chatter', isBotMentioned: false }),
            // An addressed /command — in a group it's speech, not the
            // channel-command no-op (silence would be the bug).
            groupInbound({ externalMessageId: 'g-cmd', messageBody: '/ask@bot what is up' }),
          ],
          nextCursor: '13',
        }),
      )
      await runChannelPollingTick(db)

      const rows = listInboundMessagesForChannel(db, channel.id, {})
      expect(rows).toHaveLength(2)
      const byId = new Map(rows.map((r) => [r.externalMessageId, r]))
      expect(byId.get('g-hit')?.status).toBe('pending')
      expect(byId.get('g-hit')?.intentKind).toBe('chat-turn')
      expect(byId.get('g-cmd')?.intentKind).toBe('chat-turn')
      // Sender + room facts ride the metadata for the routing slice.
      const metadata = JSON.parse(byId.get('g-hit')!.messageMetadata) as Record<string, unknown>
      expect(metadata.chatContextKind).toBe('group')
      expect(metadata.chatContextTitle).toBe('Marketing Team')
      expect(metadata.senderDisplayName).toBe('Owner')
    })
  })

  it("an approved 'allowlist' group admits only senders linked to THAT group", async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      seedGroup(db, channel, { status: 'approved', memberPolicy: 'allowlist' })
      // Alice is allowed IN THIS GROUP; the seeded '123456' link is DM-scoped only.
      insertAllowedSender(db, {
        id: randomUUID(),
        channelId: channel.id,
        externalSenderId: 'alice-1',
        externalSenderHandle: '@alice',
        externalSenderDisplayName: 'Alice',
        scopeContextId: '-100777',
        addedAt: new Date(),
      })
      vi.mocked(resolveChannelAdapter).mockReturnValue(
        makeStubAdapter({
          messages: [
            groupInbound({ externalMessageId: 'g-alice', externalSenderId: 'alice-1' }),
            // The channel owner's DM link does NOT carry into the group scope.
            groupInbound({ externalMessageId: 'g-owner', externalSenderId: '123456' }),
          ],
          nextCursor: '14',
        }),
      )
      await runChannelPollingTick(db)

      const byId = new Map(
        listInboundMessagesForChannel(db, channel.id, {}).map((r) => [r.externalMessageId, r.status]),
      )
      expect(byId.get('g-alice')).toBe('pending')
      expect(byId.get('g-owner')).toBe('ignored')
    })
  })

  it('an ignored group stays silent, but its title/liveness refresh on sight', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      const group = seedGroup(db, channel, { status: 'ignored', title: 'Old Name' })
      vi.mocked(resolveChannelAdapter).mockReturnValue(
        makeStubAdapter({
          messages: [groupInbound({ chatContextTitle: 'New Name' })],
          nextCursor: '15',
        }),
      )
      await runChannelPollingTick(db)

      expect(listInboundMessagesForChannel(db, channel.id, {})).toHaveLength(0)
      const refreshed = findChannelChatGroup(db, {
        channelId: channel.id,
        externalChatContextId: group.externalChatContextId,
      })
      expect(refreshed?.title).toBe('New Name')
      expect(refreshed?.lastInboundAt).not.toBeNull()
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
