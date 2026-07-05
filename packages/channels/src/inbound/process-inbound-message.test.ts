import { describe, it, expect, vi, beforeEach } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { listReadyOutboundMessages, findInboundMessageById } from '../repositories/index.js'
import {
  seedChannelWithAllowedSender,
  insertPendingChatTurnMessage,
  stubTurnDeps,
} from '../test-support.js'

// route-as-chat-turn sends a "typing…" indicator via the telegram adapter — mock the
// network boundary so it no-ops.
const { sendChatAction } = vi.hoisted(() => ({ sendChatAction: vi.fn() }))
vi.mock('telegraf', () => ({ Telegram: vi.fn(() => ({ sendChatAction })) }))

import { processInboundMessage } from './process-inbound-message.js'

beforeEach(() => {
  vi.clearAllMocks()
  sendChatAction.mockResolvedValue(true)
})

describe('processInboundMessage — chat-turn routes to the global root (Ch4)', () => {
  it('claims a pending chat-turn, runs the global-root turn WITH the origin, queues the reply', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      const inbound = insertPendingChatTurnMessage(db, channel.id)
      const deps = stubTurnDeps({ rootTurnResultText: 'The supplier emailed about pricing.' })

      await processInboundMessage(db, { inboundMessageId: inbound.id }, deps)

      // The global-root turn ran with the ORIGIN channel — so its reply + any delegation's
      // report come back HERE (to who asked, where they asked).
      expect(deps.state.rootTurnCalls).toHaveLength(1)
      expect(deps.state.rootTurnCalls[0]).toMatchObject({
        userId: channel.userId,
        userMessageText: 'what did the supplier email about?',
        origin: { channelId: channel.id, externalSenderId: '123456', externalChatContextId: '123456' },
      })

      // The root's answer was queued back to the sender (the direct-answer path).
      const queued = listReadyOutboundMessages(db, {})
      expect(queued).toHaveLength(1)
      expect(queued[0]?.payloadKind).toBe('chat-stream-final')
      expect(queued[0]?.externalRecipientId).toBe('123456')
      expect(queued[0]?.messageBody).toContain('supplier')

      // The "typing…" indicator fired; the inbound is completed.
      expect(sendChatAction).toHaveBeenCalledWith('123456', 'typing')
      expect(findInboundMessageById(db, inbound.id)?.status).toBe('completed')
    })
  })

  it('does not double-dispatch a claimed message (the claim wins once)', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      const inbound = insertPendingChatTurnMessage(db, channel.id)
      const deps = stubTurnDeps()

      await Promise.all([
        processInboundMessage(db, { inboundMessageId: inbound.id }, deps),
        processInboundMessage(db, { inboundMessageId: inbound.id }, deps),
      ])

      expect(deps.state.rootTurnCalls).toHaveLength(1)
    })
  })

  it('queues no reply when the root produced no text (e.g. a silent delegation)', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      const inbound = insertPendingChatTurnMessage(db, channel.id)

      await processInboundMessage(db, { inboundMessageId: inbound.id }, stubTurnDeps({ rootTurnResultText: '   ' }))

      expect(listReadyOutboundMessages(db, {})).toHaveLength(0)
      expect(findInboundMessageById(db, inbound.id)?.status).toBe('completed')
    })
  })

  it('marks the row failed AND enqueues an error status back to the sender when the root turn throws', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      const inbound = insertPendingChatTurnMessage(db, channel.id)

      await processInboundMessage(db, { inboundMessageId: inbound.id }, stubTurnDeps({ rootTurnThrows: true }))

      // Report-up unchanged: the inbound row is still marked failed + logged.
      expect(findInboundMessageById(db, inbound.id)?.status).toBe('failed')

      // The sender no longer sees silence — a brief error status is enqueued for
      // the delivery tick to ship (payloadKind 'status-update', not a chat reply).
      const queued = listReadyOutboundMessages(db, {})
      expect(queued).toHaveLength(1)
      expect(queued[0]?.payloadKind).toBe('status-update')
      expect(queued[0]?.externalRecipientId).toBe('123456')
      expect(queued[0]?.messageBody).toContain('error')
    })
  })
})
