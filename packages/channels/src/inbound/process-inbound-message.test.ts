import { describe, it, expect, vi, beforeEach } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { listReadyOutboundMessages, findInboundMessageById } from '../repositories/index.js'
import { SILENT_CHANNEL_TURN_FALLBACK } from './ship-silent-turn-fallback.js'
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

// `stubTurnDeps` wires the ROOT runner only, so these exercise the root path
// whatever the seeded channel's scope. WHICH conversation a channel's messages
// run on is `route-as-chat-turn.test.ts`'s subject (a workspace-bound channel
// answers on its workspace since 2026-08-21).
describe('processInboundMessage — the inbound chat-turn pipeline', () => {
  // test: rewritten for the silent-turn fallback (2026-08-22) — the tool-only
  // rule now reads "the model's text is never auto-shipped WHILE it has replied
  // via the tool". This stub runner never calls reply_to_channel, so the turn
  // ends having said nothing, and the fallback ships its final text rather than
  // leaving the sender with "typing…" and silence.
  it('claims a pending chat-turn, runs the root turn with origin + reply marker — and ships the fallback when it replied nothing', async () => {
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

      // The turn queued NO reply of its own, so the fallback shipped its text.
      const outbound = listReadyOutboundMessages(db, {})
      expect(outbound).toHaveLength(1)
      expect(outbound[0]?.payloadKind).toBe('chat-stream-final')
      expect(outbound[0]?.messageBody).toBe('The supplier emailed about pricing.')

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
      // test: correct expectation for the silent-turn fallback — was "only the
      // approval card". The card is unchanged; the second row is the fallback,
      // because this stub turn never called reply_to_channel. A CARD is not a
      // reply: pushing one still leaves the sender owed a word.
      expect(queued).toHaveLength(2)
      expect(queued.map((m) => m.payloadKind).sort()).toEqual([
        'approval-request',
        'chat-stream-final',
      ])
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
      // test: correct expectation for the silent-turn fallback — the stub turn
      // replied nothing, so the fallback ships its text, THREADED onto the
      // asking message exactly as a tool reply would be.
      const groupOutbound = listReadyOutboundMessages(db, {})
      expect(groupOutbound).toHaveLength(1)
      expect(groupOutbound[0]?.messageBody).toBe('Pricing went up 4%.')
      expect(groupOutbound[0]?.messageStructure).toContain(inbound.externalMessageId)
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

      // test: correct expectation for the silent-turn fallback — was "NOTHING
      // queued". Decision 3 is intact and is what this test is about: NO
      // approval card reaches the room. The one row is the fallback reply,
      // which is an answer to the person who asked, not a card anyone can tap.
      const roomOutbound = listReadyOutboundMessages(db, {})
      expect(roomOutbound.map((m) => m.payloadKind)).toEqual(['chat-stream-final'])
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

  // test: rewritten for the silent-turn fallback (agent B's GAP 3, closed
  // 2026-08-22) — was "queues no reply when the root produced no text". That
  // WAS the gap: a blocked tool, a timed-out card or a text-only turn all end
  // here, and the sender saw "typing…" stop and then nothing at all.
  it('ships the fixed line when the turn produced NO text and no reply (blocked tool / timed-out card)', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      const inbound = insertPendingChatTurnMessage(db, channel.id)

      await processInboundMessage(db, { inboundMessageId: inbound.id }, stubTurnDeps({ rootTurnResultText: '   ' }))

      const outbound = listReadyOutboundMessages(db, {})
      expect(outbound).toHaveLength(1)
      expect(outbound[0]?.messageBody).toBe(SILENT_CHANNEL_TURN_FALLBACK)
      expect(findInboundMessageById(db, inbound.id)?.status).toBe('completed')
    })
  })

  // ⚠ THE ARC'S OWN MAIN FLOW, pinned so the behaviour is a decision and not a
  // discovery: Telegram → the root DELEGATES → the root turn ends without
  // calling reply_to_channel (its answer is not ready). The fallback ships the
  // root's own closing text as an INTERIM ACK, and the real answer follows
  // later as the requester's report — two messages, and the first is model text
  // nobody reviewed. That is the shape Kafi asked for ("the model's final text
  // if there is any"), and it beats the old silence; the alternative — gating
  // the fallback when this turn enqueued a delegation carrying the same origin
  // — is a live-smoke call, not one to make here.
  it('a turn that DELEGATED and did not reply ships its closing text as an interim ack', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      const inbound = insertPendingChatTurnMessage(db, channel.id)
      const deps = stubTurnDeps({
        rootTurnResultText: "I've asked the Acme workspace to look into this — I'll come back to you.",
      })

      await processInboundMessage(db, { inboundMessageId: inbound.id }, deps)

      const outbound = listReadyOutboundMessages(db, {})
      expect(outbound).toHaveLength(1)
      expect(outbound[0]?.messageBody).toBe(
        "I've asked the Acme workspace to look into this — I'll come back to you.",
      )
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
