import { describe, it, expect, vi, beforeEach } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { listReadyOutboundMessages, findInboundMessageById } from '../repositories/index.js'
import {
  seedChannelWithAllowedSender,
  insertPendingChatTurnMessage,
  insertPendingGroupChatTurnMessage,
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
  // test: recast for the channel pipeline (Chad, locked 2026-07-27) — the
  // turn's chat text is NEVER captured and queued; the model replies via the
  // reply_to_channel tool (the per-message marker instructs it every turn).
  it('claims a pending chat-turn, runs the root turn with origin + reply marker — and queues NOTHING itself', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      const inbound = insertPendingChatTurnMessage(db, channel.id)
      const deps = stubTurnDeps({ rootTurnResultText: 'The supplier emailed about pricing.' })

      await processInboundMessage(db, { inboundMessageId: inbound.id }, deps)

      // The global-root turn ran with the ORIGIN channel (addresses the
      // reply_to_channel tool + any delegation's report) and the per-message
      // reply instruction. A DM origin carries NO externalMessageId.
      expect(deps.state.rootTurnCalls).toHaveLength(1)
      expect(deps.state.rootTurnCalls[0]).toMatchObject({
        userId: channel.userId,
        userMessageText: 'what did the supplier email about?',
        origin: { channelId: channel.id, externalSenderId: '123456', externalChatContextId: '123456' },
      })
      expect(deps.state.rootTurnCalls[0]?.origin).not.toHaveProperty('externalMessageId')
      expect(deps.state.rootTurnCalls[0]?.channelReplyMarker).toContain('reply_to_channel')
      expect(deps.state.rootTurnCalls[0]?.channelReplyMarker).toContain('TELEGRAM')

      // NO capture: the answer text was not queued — replying is the model's
      // own tool call, inside the turn.
      expect(listReadyOutboundMessages(db, {})).toHaveLength(0)

      // The "typing…" indicator fired; the inbound is completed.
      expect(sendChatAction).toHaveBeenCalledWith('123456', 'typing')
      expect(findInboundMessageById(db, inbound.id)?.status).toBe('completed')
    })
  })

  it('pushes a brain-turn approval card back to the sender (surface-up) with typed-reply correlation', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      const inbound = insertPendingChatTurnMessage(db, channel.id, 'set up a workspace for acme')
      const deps = stubTurnDeps({
        rootTurnResultText: 'Workspace created.',
        emitApproval: {
          approvalRequestId: 'appr-brain-1',
          toolName: 'register_workspace',
          toolInput: { name: 'acme' },
        },
      })

      await processInboundMessage(db, { inboundMessageId: inbound.id }, deps)

      const queued = listReadyOutboundMessages(db, {})
      // test: recast (channel pipeline) — only the approval card; the final
      // reply is the model's own reply_to_channel call, never a capture.
      expect(queued).toHaveLength(1)
      const card = queued.find((m) => m.payloadKind === 'approval-request')!
      expect(card.externalRecipientId).toBe('123456')
      expect(card.messageBody).toContain('register_workspace')
      expect(card.messageStructure).toContain('approval:approve:appr-brain-1')
      // Reply-to + the typed-reply stamp — "approve" from this sender correlates (§5.7).
      expect(card.messageStructure).toContain(inbound.externalMessageId)
      expect(findInboundMessageById(db, inbound.id)?.routedToApprovalRequestId).toBe('appr-brain-1')
    })
  })

  it('a GROUP turn opens with a speaker line; its origin carries the asking message for tool threading', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      const inbound = insertPendingGroupChatTurnMessage(db, channel.id)
      const deps = stubTurnDeps({ rootTurnResultText: 'Pricing went up 4%.' })

      await processInboundMessage(db, { inboundMessageId: inbound.id }, deps)

      // The model (and the transcript) sees WHO in the room asked.
      expect(deps.state.rootTurnCalls[0]?.userMessageText).toBe(
        '[Group message from Alice in "Marketing Team"]\n\n@bot what did the supplier email about?',
      )
      // test: recast (channel pipeline) — the reply is the model's own
      // reply_to_channel call; the ORIGIN carries the asking message's id so
      // the tool reply threads onto it, and the marker names the room.
      expect(deps.state.rootTurnCalls[0]?.origin).toMatchObject({
        externalChatContextId: '-100777',
        externalMessageId: inbound.externalMessageId,
      })
      expect(deps.state.rootTurnCalls[0]?.channelReplyMarker).toContain('Marketing Team')
      expect(listReadyOutboundMessages(db, {})).toHaveLength(0)
    })
  })

  it('NEVER posts an approval card into a group — the card stays app-only (decision 3)', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      const inbound = insertPendingGroupChatTurnMessage(db, channel.id, 'set up a workspace')
      const deps = stubTurnDeps({
        rootTurnResultText: 'Workspace created.',
        emitApproval: {
          approvalRequestId: 'appr-group-1',
          toolName: 'register_workspace',
          toolInput: { name: 'acme' },
        },
      })

      await processInboundMessage(db, { inboundMessageId: inbound.id }, deps)

      // test: recast (channel pipeline) — NOTHING queued: no approval card for
      // the room (decision 3) and no captured reply (tool-only replies).
      expect(listReadyOutboundMessages(db, {})).toHaveLength(0)
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
