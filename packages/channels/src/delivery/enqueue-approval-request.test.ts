// Tests for the approval-card producers. The chat-turn producer is exercised via
// translate-chat-event-to-channel.test.ts; here the DELEGATION-ORIGIN variant
// (surface-up): addressed straight to the job's origin recipient, buttons carry
// the explicit approval id, and — with no inbound row — nothing is stamped for
// typed-reply correlation.

import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { listReadyOutboundMessages } from '../repositories/index.js'
import { seedChannel } from '../test-support.js'
import { enqueueApprovalRequestForRecipient } from './enqueue-approval-request.js'

describe('enqueueApprovalRequestForRecipient', () => {
  it('queues an approval-request card to the origin recipient with explicit-id buttons', async () => {
    await withTestDatabase((db) => {
      const { channel } = seedChannel(db)

      enqueueApprovalRequestForRecipient(db, {
        channel,
        externalRecipientId: 'tg-42',
        externalChatContextId: 'chat-7',
        card: { approvalRequestId: 'appr-9', toolName: 'Write', toolInput: { file_path: '/x' } },
      })

      const queued = listReadyOutboundMessages(db, {})
      expect(queued).toHaveLength(1)
      expect(queued[0]).toMatchObject({
        channelId: channel.id,
        externalRecipientId: 'tg-42',
        externalChatContextId: 'chat-7',
        payloadKind: 'approval-request',
        status: 'pending',
      })
      expect(queued[0]!.messageBody).toContain('Write')

      const structure = JSON.parse(queued[0]!.messageStructure) as {
        inlineButtons?: { payload: string }[]
        replyToExternalMessageId?: string
      }
      // Telegram supports inline buttons — both carry the EXPLICIT approval id
      // (a tap always correlates; there is no inbound to stamp for typed replies).
      expect(structure.inlineButtons?.map((b) => b.payload)).toEqual([
        'approval:approve:appr-9',
        'approval:deny:appr-9',
      ])
      expect(structure.replyToExternalMessageId).toBeUndefined()
    })
  })
})
