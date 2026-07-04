import { describe, it, expect, vi, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { ConflictError } from '@vynel/errors'
import {
  insertInboundMessage,
  updateInboundMessage,
  listReadyOutboundMessages,
  type Channel,
  type ChannelInboundMessage,
} from '../repositories/index.js'
import { seedChannelWithAllowedSender } from '../test-support.js'
import type { Database } from '@vynel/db'

import { routeAsApprovalReply } from './route-as-approval-reply.js'

// Structurally injected (the leaf never imports the approvals leaf) — the real
// `resolveApproval` is supplied by app-wiring; here a fake stands in via deps.
const resolveApproval = vi.fn()

const SENDER = '123456'

function replyMessage(channel: Channel, messageBody: string): ChannelInboundMessage {
  return {
    id: randomUUID(),
    channelId: channel.id,
    externalMessageId: `m-${randomUUID()}`,
    externalSenderId: SENDER,
    externalChatContextId: SENDER,
    messageBody,
    messageMetadata: '{}',
    intentKind: 'approval-reply',
    routedToChatSessionId: null,
    routedToApprovalRequestId: null,
    status: 'routed',
    statusMessage: null,
    receivedAt: new Date(),
    processedAt: null,
  }
}

function seedPendingApprovalRef(db: Database, channel: Channel, approvalId: string): void {
  // A prior inbound that surfaced an approval — the typed-text correlation target.
  const m = insertInboundMessage(db, replyMessage(channel, 'send the email'))
  updateInboundMessage(db, m.id, { routedToApprovalRequestId: approvalId })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('routeAsApprovalReply', () => {
  it('resolves a button payload with the explicit approvalRequestId (approve)', async () => {
    resolveApproval.mockResolvedValue({})
    await withTestDatabase(async (db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      await routeAsApprovalReply(db, { channel, message: replyMessage(channel, 'approval:approve:req-XYZ') }, { resolveApproval })
      expect(resolveApproval).toHaveBeenCalledTimes(1)
      const input = resolveApproval.mock.calls[0]?.[1]
      expect(input.providerApprovalId).toBe('req-XYZ')
      expect(input.decision.kind).toBe('approved')
      const queued = listReadyOutboundMessages(db, {})
      expect(queued[0]?.payloadKind).toBe('approval-resolved')
      expect(queued[0]?.messageBody).toContain('Approved')
    })
  })

  it('resolves a typed "deny <reason>" against the sender’s most-recent surfaced approval', async () => {
    resolveApproval.mockResolvedValue({})
    await withTestDatabase(async (db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      seedPendingApprovalRef(db, channel, 'req-typed')
      await routeAsApprovalReply(db, { channel, message: replyMessage(channel, 'deny too risky') }, { resolveApproval })
      const input = resolveApproval.mock.calls[0]?.[1]
      expect(input.providerApprovalId).toBe('req-typed')
      expect(input.decision).toEqual({ kind: 'denied', reason: 'too risky' })
    })
  })

  it('nudges when the reply is unparseable', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      await routeAsApprovalReply(db, { channel, message: replyMessage(channel, 'hello there') }, { resolveApproval })
      expect(resolveApproval).not.toHaveBeenCalled()
      const queued = listReadyOutboundMessages(db, {})
      expect(queued[0]?.payloadKind).toBe('status-update')
    })
  })

  it('reports "no pending approval" when a typed reply has nothing to resolve', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      await routeAsApprovalReply(db, { channel, message: replyMessage(channel, 'approve') }, { resolveApproval })
      expect(resolveApproval).not.toHaveBeenCalled()
      const queued = listReadyOutboundMessages(db, {})
      expect(queued[0]?.messageBody).toContain('no pending approval')
    })
  })

  it('reports when the approval was already handled (ConflictError)', async () => {
    resolveApproval.mockRejectedValue(new ConflictError('already resolved'))
    await withTestDatabase(async (db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      await routeAsApprovalReply(db, { channel, message: replyMessage(channel, 'approval:approve:req-1') }, { resolveApproval })
      const queued = listReadyOutboundMessages(db, {})
      expect(queued[0]?.messageBody).toContain('already handled')
    })
  })
})
