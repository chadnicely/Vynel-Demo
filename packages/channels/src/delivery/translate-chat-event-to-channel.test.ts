import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { listReadyOutboundMessages, findInboundMessageById } from '../repositories/index.js'
import { seedChannelWithAllowedSender, insertPendingChatTurnMessage } from '../test-support.js'
import { createChannelEventTranslator } from './translate-chat-event-to-channel.js'
import type { ChatTurnEvent, ChatSessionResponse } from '@vynel/contracts/chat/chat-http'

describe('createChannelEventTranslator', () => {
  it('buffers text chunks and flushes ONE reply at session-completed', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      const inbound = insertPendingChatTurnMessage(db, channel.id)
      const translate = createChannelEventTranslator(db, { channel, inboundMessage: inbound })

      translate({ kind: 'text-chunk', messageId: 'm', textDelta: 'Hello ' })
      translate({ kind: 'text-chunk', messageId: 'm', textDelta: 'world.' })
      expect(listReadyOutboundMessages(db, {})).toHaveLength(0) // nothing sent mid-stream
      translate({ kind: 'session-completed', sessionId: 's' })

      const queued = listReadyOutboundMessages(db, {})
      expect(queued).toHaveLength(1)
      expect(queued[0]?.payloadKind).toBe('chat-stream-final')
      expect(queued[0]?.messageBody).toBe('Hello world.')
    })
  })

  it('records the session id on session-created', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      const inbound = insertPendingChatTurnMessage(db, channel.id)
      const translate = createChannelEventTranslator(db, { channel, inboundMessage: inbound })
      translate({ kind: 'session-created', session: { id: 'sess-xyz' } as unknown as ChatSessionResponse })
      expect(findInboundMessageById(db, inbound.id)?.routedToChatSessionId).toBe('sess-xyz')
    })
  })

  it('enqueues an approval-request and records the approval ref on approval-requested', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      const inbound = insertPendingChatTurnMessage(db, channel.id)
      const translate = createChannelEventTranslator(db, { channel, inboundMessage: inbound })
      const event: Extract<ChatTurnEvent, { kind: 'approval-requested' }> = {
        kind: 'approval-requested',
        approvalRequestId: 'req-1',
        parentMessageId: 'p',
        toolName: 'Bash',
        toolInput: { command: 'rm -rf /tmp/x' },
        requestedAt: new Date().toISOString(),
      }
      translate(event)
      const queued = listReadyOutboundMessages(db, {})
      expect(queued).toHaveLength(1)
      expect(queued[0]?.payloadKind).toBe('approval-request')
      const structure = JSON.parse(queued[0]!.messageStructure)
      expect(structure.inlineButtons[0].payload).toBe('approval:approve:req-1')
      expect(findInboundMessageById(db, inbound.id)?.routedToApprovalRequestId).toBe('req-1')
    })
  })

  it('emits a status-update on session-errored', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      const inbound = insertPendingChatTurnMessage(db, channel.id)
      const translate = createChannelEventTranslator(db, { channel, inboundMessage: inbound })
      translate({
        kind: 'session-errored',
        sessionId: 's',
        errorCode: 'boom',
        errorMessage: 'the agent fell over',
        isRecoverable: false,
      })
      const queued = listReadyOutboundMessages(db, {})
      expect(queued).toHaveLength(1)
      expect(queued[0]?.payloadKind).toBe('status-update')
      expect(queued[0]?.messageBody).toContain('the agent fell over')
    })
  })

  it('flushes nothing when the turn produced no text', async () => {
    await withTestDatabase(async (db) => {
      const { channel } = seedChannelWithAllowedSender(db)
      const inbound = insertPendingChatTurnMessage(db, channel.id)
      const translate = createChannelEventTranslator(db, { channel, inboundMessage: inbound })
      translate({ kind: 'session-completed', sessionId: 's' })
      expect(listReadyOutboundMessages(db, {})).toHaveLength(0)
    })
  })
})
