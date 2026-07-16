import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import {
  insertAllowedSender,
  insertChannel,
  listReadyOutboundMessages,
  updateChannel,
} from '../repositories/index.js'
import { seedChannel, seedChannelWithAllowedSender } from '../test-support.js'
import { consumeAskCreatedEvent, type AskCreatedPayload } from './consume-ask-created-event.js'

// A second channel row for an EXISTING user (test-support's seedChannel always
// mints a fresh user, but the fallback-priority case needs two channels on one).
function makeChannelRow(userId: string, workspaceId: string | null) {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    workspaceId,
    channelKind: 'telegram' as const,
    displayName: 'Global Bot',
    botCredentials: JSON.stringify({ botToken: 'secret-token' }),
    botMetadata: JSON.stringify({ username: 'global_bot', id: 43 }),
    connectionStatus: 'healthy' as const,
    connectionStatusMessage: null,
    lastPolledCursor: null,
    lastPolledAt: null,
    lastInboundAt: null,
    isEnabled: true,
    createdAt: now,
    updatedAt: now,
  }
}

function payload(overrides: Partial<AskCreatedPayload> = {}): AskCreatedPayload {
  return {
    askId: 'ask-1',
    userId: 'user-1',
    workspaceId: 'ws-1',
    questionCount: 3,
    firstQuestionLabel: 'Who is this newsletter for?',
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('consumeAskCreatedEvent', () => {
  it('enqueues an ask-nudge to the channel owner with the plain-language body', async () => {
    await withTestDatabase(async (db) => {
      const { channel, sender } = seedChannelWithAllowedSender(db)
      consumeAskCreatedEvent(
        db,
        payload({ userId: channel.userId, workspaceId: channel.workspaceId }),
      )
      const queued = listReadyOutboundMessages(db, {})
      expect(queued).toHaveLength(1)
      expect(queued[0]?.payloadKind).toBe('ask-nudge')
      expect(queued[0]?.externalRecipientId).toBe(sender.externalSenderId)
      expect(queued[0]?.messageBody).toContain('Claude needs your input')
      expect(queued[0]?.messageBody).toContain('Who is this newsletter for?')
      expect(queued[0]?.messageBody).toContain('+2 more questions')
    })
  })

  it("a single-question ask carries no '+N more' suffix", async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      consumeAskCreatedEvent(
        db,
        payload({ userId: channel.userId, workspaceId: channel.workspaceId, questionCount: 1 }),
      )
      expect(listReadyOutboundMessages(db, {})[0]?.messageBody).not.toContain('more question')
    })
  })

  it('prefers a GLOBAL channel over an other-workspace one when no workspace match exists', async () => {
    await withTestDatabase(async (db) => {
      // One user, two enabled channels: other-workspace + global. The ask's
      // own workspace has no channel → the GLOBAL one must win the fallback.
      const otherWorkspace = seedChannelWithAllowedSender(db)
      const globalChannel = insertChannel(db, {
        ...makeChannelRow(otherWorkspace.channel.userId, null),
      })
      insertAllowedSender(db, {
        id: randomUUID(),
        channelId: globalChannel.id,
        externalSenderId: '777',
        externalSenderHandle: '@owner',
        externalSenderDisplayName: 'The Owner',
        scopeContextId: '777',
        addedAt: new Date(),
      })

      consumeAskCreatedEvent(
        db,
        payload({ userId: otherWorkspace.channel.userId, workspaceId: 'workspace-with-no-channel' }),
      )
      const queued = listReadyOutboundMessages(db, {})
      expect(queued).toHaveLength(1)
      expect(queued[0]?.channelId).toBe(globalChannel.id)
    })
  })

  it('falls back to ANY enabled channel when no workspace/global match exists', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      // The ask came from a DIFFERENT workspace than the channel's — the nudge
      // still lands on the user's only enabled channel.
      consumeAskCreatedEvent(
        db,
        payload({ userId: channel.userId, workspaceId: 'some-other-workspace' }),
      )
      expect(listReadyOutboundMessages(db, {})).toHaveLength(1)
    })
  })

  it('drops quietly when the channel is disabled / no sender / no channel', async () => {
    await withTestDatabase(async (db) => {
      const disabled = seedChannelWithAllowedSender(db)
      updateChannel(db, disabled.channel.id, { isEnabled: false })
      consumeAskCreatedEvent(
        db,
        payload({ userId: disabled.channel.userId, workspaceId: disabled.channel.workspaceId }),
      )
      expect(listReadyOutboundMessages(db, {})).toHaveLength(0)

      const senderless = seedChannel(db) // no allowlist
      consumeAskCreatedEvent(
        db,
        payload({ userId: senderless.channel.userId, workspaceId: senderless.channel.workspaceId }),
      )
      expect(listReadyOutboundMessages(db, {})).toHaveLength(0)

      consumeAskCreatedEvent(db, payload({ userId: 'user-with-no-channels' }))
      expect(listReadyOutboundMessages(db, {})).toHaveLength(0)
    })
  })
})
