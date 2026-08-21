// The silent-turn fallback's own decision, over real SQLite: WHEN it speaks,
// WHAT it says, and — the half that keeps the 2026-07-27 rule intact — when it
// stays out of the way.

import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { enqueueChannelReply } from '../delivery/enqueue-channel-reply.js'
import { enqueueChannelStatus } from '../delivery/enqueue-channel-status.js'
import { listOutboundMessagesForChannel } from '../repositories/index.js'
import { seedChannelWithAllowedSender, insertPendingChatTurnMessage } from '../test-support.js'
import {
  shipSilentChannelTurnFallback,
  SILENT_CHANNEL_TURN_FALLBACK,
} from './ship-silent-turn-fallback.js'

describe('shipSilentChannelTurnFallback — a channel turn never ends in silence', () => {
  it('ships the model’s own final text when the turn replied nothing', async () => {
    await withTestDatabase((db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      const message = insertPendingChatTurnMessage(db, channel.id)

      const shipped = shipSilentChannelTurnFallback(db, {
        channel,
        message,
        resultText: '  The supplier raised prices 4%.  ',
        turnStartedAt: new Date(Date.now() - 1000),
        isGroupOrigin: false,
      })

      expect(shipped).toBe(true)
      const outbound = listOutboundMessagesForChannel(db, channel.id)
      expect(outbound).toHaveLength(1)
      expect(outbound[0]).toMatchObject({
        messageBody: 'The supplier raised prices 4%.',
        payloadKind: 'chat-stream-final',
        externalChatContextId: message.externalChatContextId,
      })
    })
  })

  it('ships the fixed line when there is no text either — the blocked/timed-out shape', async () => {
    await withTestDatabase((db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      const message = insertPendingChatTurnMessage(db, channel.id)

      shipSilentChannelTurnFallback(db, {
        channel,
        message,
        resultText: '   ',
        turnStartedAt: new Date(Date.now() - 1000),
        isGroupOrigin: false,
      })

      expect(listOutboundMessagesForChannel(db, channel.id)[0]?.messageBody).toBe(
        SILENT_CHANNEL_TURN_FALLBACK,
      )
    })
  })

  it('STAYS SILENT when the turn already replied through the tool — the 2026-07-27 rule, intact', async () => {
    await withTestDatabase((db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      const message = insertPendingChatTurnMessage(db, channel.id)
      const turnStartedAt = new Date(Date.now() - 1000)
      // What `reply_to_channel` leaves behind.
      enqueueChannelReply(db, { channel, message, body: 'Prices are up 4%.' })

      const shipped = shipSilentChannelTurnFallback(db, {
        channel,
        message,
        resultText: 'Long internal reasoning the sender must never receive.',
        turnStartedAt,
        isGroupOrigin: false,
      })

      expect(shipped).toBe(false)
      expect(listOutboundMessagesForChannel(db, channel.id).map((m) => m.messageBody)).toEqual([
        'Prices are up 4%.',
      ])
    })
  })

  it('a reply from BEFORE this turn does not count — only what this turn queued', async () => {
    await withTestDatabase((db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      const message = insertPendingChatTurnMessage(db, channel.id)
      enqueueChannelReply(db, { channel, message, body: 'yesterday’s answer' })

      const shipped = shipSilentChannelTurnFallback(db, {
        channel,
        message,
        resultText: 'today’s answer',
        turnStartedAt: new Date(Date.now() + 1000),
        isGroupOrigin: false,
      })

      expect(shipped).toBe(true)
    })
  })

  it('an approval CARD is not a reply — a turn that only cards still owes the sender a word', async () => {
    await withTestDatabase((db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      const message = insertPendingChatTurnMessage(db, channel.id)
      enqueueChannelStatus(db, { channel, message }, 'Approve register_workspace?', 'approval-request')

      expect(
        shipSilentChannelTurnFallback(db, {
          channel,
          message,
          resultText: '',
          turnStartedAt: new Date(Date.now() - 1000),
          isGroupOrigin: false,
        }),
      ).toBe(true)
    })
  })

  it('threads onto the asking message in a group, the way a tool reply does', async () => {
    await withTestDatabase((db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      const message = insertPendingChatTurnMessage(db, channel.id)

      shipSilentChannelTurnFallback(db, {
        channel,
        message,
        resultText: 'Answer for the room.',
        turnStartedAt: new Date(Date.now() - 1000),
        isGroupOrigin: true,
      })

      expect(listOutboundMessagesForChannel(db, channel.id)[0]?.messageStructure).toContain(
        message.externalMessageId,
      )
    })
  })

  it('a SIBLING turn’s reply in the same chat does not silence this turn', async () => {
    await withTestDatabase((db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      const message = insertPendingChatTurnMessage(db, channel.id)
      // Inbound messages run concurrently: another turn answered ITS message in
      // the same conversation, inside this turn's window. Before correlation
      // that reply suppressed this turn's line and the sender heard nothing.
      enqueueChannelReply(db, {
        channel,
        message,
        body: 'answering the other message',
        turnCorrelationId: 'a-sibling-turn',
      })

      const shipped = shipSilentChannelTurnFallback(db, {
        channel,
        message,
        resultText: 'and here is yours',
        turnStartedAt: new Date(Date.now() - 1000),
        turnCorrelationId: message.id,
        isGroupOrigin: false,
      })

      expect(shipped).toBe(true)
      expect(listOutboundMessagesForChannel(db, channel.id).map((m) => m.messageBody)).toEqual([
        'answering the other message',
        'and here is yours',
      ])
    })
  })

  it('THIS turn’s own reply still silences it — the tool answered, byte for byte', async () => {
    await withTestDatabase((db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      const message = insertPendingChatTurnMessage(db, channel.id)
      enqueueChannelReply(db, {
        channel,
        message,
        body: 'Prices are up 4%.',
        turnCorrelationId: message.id,
      })

      const shipped = shipSilentChannelTurnFallback(db, {
        channel,
        message,
        resultText: 'Long internal reasoning the sender must never receive.',
        turnStartedAt: new Date(Date.now() - 1000),
        turnCorrelationId: message.id,
        isGroupOrigin: false,
      })

      expect(shipped).toBe(false)
      expect(listOutboundMessagesForChannel(db, channel.id).map((m) => m.messageBody)).toEqual([
        'Prices are up 4%.',
      ])
    })
  })

  it('trims a reply past the tightest channel limit rather than losing the delivery', async () => {
    await withTestDatabase((db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      const message = insertPendingChatTurnMessage(db, channel.id)

      shipSilentChannelTurnFallback(db, {
        channel,
        message,
        resultText: 'x'.repeat(9000),
        turnStartedAt: new Date(Date.now() - 1000),
        isGroupOrigin: false,
      })

      const body = listOutboundMessagesForChannel(db, channel.id)[0]?.messageBody ?? ''
      expect(body).toHaveLength(4096)
      expect(body.endsWith('…')).toBe(true)
    })
  })
})
