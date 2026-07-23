// Tests for `TelegramChannelAdapter`. The network boundary (`telegraf`)
// is mocked — NOT the DB (the adapter is DB-free). Per
// `docs/blueprints/channels/coding.md §8`.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getMe, getUpdates, sendMessage, editMessageText, sendChatAction } = vi.hoisted(() => ({
  getMe: vi.fn(),
  getUpdates: vi.fn(),
  sendMessage: vi.fn(),
  editMessageText: vi.fn(),
  sendChatAction: vi.fn(),
}))

vi.mock('telegraf', () => ({
  Telegram: vi.fn(() => ({ getMe, getUpdates, sendMessage, editMessageText, sendChatAction })),
}))

import { TelegramChannelAdapter } from './telegram-channel-adapter.js'

const adapter = new TelegramChannelAdapter()
const credentials = { botToken: '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('TelegramChannelAdapter', () => {
  it('channelKind is telegram and capabilities are advertised', () => {
    expect(adapter.channelKind).toBe('telegram')
    expect(adapter.supportsInlineButtons()).toBe(true)
    expect(adapter.supportsMessageEditing()).toBe(true)
    expect(adapter.supportsTypingIndicator()).toBe(true)
  })

  it('sendTypingIndicator sends the telegram "typing" chat action', async () => {
    sendChatAction.mockResolvedValue(true)
    await adapter.sendTypingIndicator({ botCredentials: credentials, chatContextId: '7' })
    expect(sendChatAction).toHaveBeenCalledWith('7', 'typing')
  })

  it('verifyCredentials maps a valid getMe() to { kind: "valid" }', async () => {
    getMe.mockResolvedValue({ id: 42, first_name: 'Bakery', username: 'bakery_bot' })
    const result = await adapter.verifyCredentials({ botCredentials: credentials })
    expect(result.kind).toBe('valid')
    if (result.kind === 'valid') {
      expect(result.botDisplayName).toBe('Bakery')
      expect(result.botHandle).toBe('bakery_bot')
      expect(result.botMetadata.id).toBe(42)
    }
  })

  it('verifyCredentials maps a rejected token to { kind: "invalid" } with a scrubbed reason', async () => {
    getMe.mockRejectedValue(new Error('401: Unauthorized for 123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'))
    const result = await adapter.verifyCredentials({ botCredentials: credentials })
    expect(result.kind).toBe('invalid')
    if (result.kind === 'invalid') {
      expect(result.reasonMessage).toContain('401')
      expect(result.reasonMessage).toContain('***')
      expect(result.reasonMessage).not.toContain('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
    }
  })

  it('pollForInboundMessages normalizes text messages, skips non-text, advances the cursor', async () => {
    getUpdates.mockResolvedValue([
      {
        update_id: 10,
        message: {
          message_id: 5,
          from: { id: 7, username: 'alice', first_name: 'Alice' },
          chat: { id: 7 },
          text: 'what did the supplier email about?',
          date: 1_700_000_000,
        },
      },
      // a non-text update (e.g. a sticker) — must be skipped, but the
      // cursor still advances past it.
      { update_id: 11, message: { message_id: 6, chat: { id: 7 }, date: 1_700_000_001 } },
    ])
    const { messages, nextCursor } = await adapter.pollForInboundMessages({
      channelId: 'c1',
      botCredentials: credentials,
      sinceCursor: '5',
    })
    expect(messages).toHaveLength(1)
    expect(messages[0]?.externalMessageId).toBe('5')
    expect(messages[0]?.externalSenderId).toBe('7')
    expect(messages[0]?.externalSenderHandle).toBe('alice')
    expect(messages[0]?.messageBody).toBe('what did the supplier email about?')
    // No chat.type in the payload → reads as a DM (the pre-groups shape).
    expect(messages[0]?.chatContextKind).toBe('dm')
    expect(messages[0]?.isBotMentioned).toBe(true)
    expect(nextCursor).toBe('12') // maxUpdateId 11 + 1
    expect(getUpdates).toHaveBeenCalledWith(0, 100, 5, ['message', 'callback_query'])
  })

  it('pollForInboundMessages normalizes group context and detects @mentions via entities', async () => {
    const text = '@bakery_bot what is on the plan? not email@bakery_bot.dev'
    getUpdates.mockResolvedValue([
      {
        update_id: 30,
        message: {
          message_id: 8,
          from: { id: 7, username: 'alice', first_name: 'Alice' },
          chat: { id: -100777, type: 'supergroup', title: 'Marketing Team' },
          text,
          // Only the FIRST @bakery_bot is a mention entity; the email-shaped
          // substring later has no entity and must not count.
          entities: [{ type: 'mention', offset: 0, length: 11 }],
          date: 1_700_000_002,
        },
      },
      {
        update_id: 31,
        message: {
          message_id: 9,
          from: { id: 8, username: 'bob', first_name: 'Bob' },
          chat: { id: -100777, type: 'supergroup', title: 'Marketing Team' },
          text: 'room chatter with no mention',
          date: 1_700_000_003,
        },
      },
    ])
    const { messages } = await adapter.pollForInboundMessages({
      channelId: 'c1',
      botCredentials: credentials,
      botIdentity: { externalId: '42', handle: 'bakery_bot' },
    })
    expect(messages).toHaveLength(2)
    expect(messages[0]?.chatContextKind).toBe('group')
    expect(messages[0]?.chatContextTitle).toBe('Marketing Team')
    expect(messages[0]?.isBotMentioned).toBe(true)
    expect(messages[1]?.isBotMentioned).toBe(false)
  })

  it('a group reply to the bot’s own message counts as addressed; without botIdentity nothing does', async () => {
    const groupReply = {
      update_id: 40,
      message: {
        message_id: 12,
        from: { id: 7, username: 'alice', first_name: 'Alice' },
        chat: { id: -100777, type: 'group', title: 'Marketing Team' },
        text: 'yes do that',
        reply_to_message: { from: { id: 42, username: 'bakery_bot', first_name: 'Bakery' } },
        date: 1_700_000_004,
      },
    }
    getUpdates.mockResolvedValue([groupReply])
    const withIdentity = await adapter.pollForInboundMessages({
      channelId: 'c1',
      botCredentials: credentials,
      botIdentity: { externalId: '42', handle: 'bakery_bot' },
    })
    expect(withIdentity.messages[0]?.isBotMentioned).toBe(true)

    getUpdates.mockResolvedValue([groupReply])
    const withoutIdentity = await adapter.pollForInboundMessages({
      channelId: 'c1',
      botCredentials: credentials,
    })
    expect(withoutIdentity.messages[0]?.isBotMentioned).toBe(false)
  })

  it('pollForInboundMessages ingests inline-button taps (callback_query) as inbound', async () => {
    getUpdates.mockResolvedValue([
      {
        update_id: 20,
        callback_query: {
          id: 'cbq-1',
          from: { id: 7, username: 'alice', first_name: 'Alice' },
          message: { message_id: 5, chat: { id: 7 } },
          data: 'approval:approve:req-123',
        },
      },
    ])
    const { messages, nextCursor } = await adapter.pollForInboundMessages({
      channelId: 'c1',
      botCredentials: credentials,
      sinceCursor: '20',
    })
    expect(messages).toHaveLength(1)
    expect(messages[0]?.externalMessageId).toBe('cbq:cbq-1')
    expect(messages[0]?.externalSenderId).toBe('7')
    expect(messages[0]?.messageBody).toBe('approval:approve:req-123')
    expect(messages[0]?.messageMetadata.isCallback).toBe(true)
    // A tap on the bot's own button is inherently addressed to the bot.
    expect(messages[0]?.isBotMentioned).toBe(true)
    expect(messages[0]?.chatContextKind).toBe('dm')
    expect(nextCursor).toBe('21')
  })

  it('pollForInboundMessages keeps the prior cursor when there are no updates', async () => {
    getUpdates.mockResolvedValue([])
    const { messages, nextCursor } = await adapter.pollForInboundMessages({
      channelId: 'c1',
      botCredentials: credentials,
      sinceCursor: '42',
    })
    expect(messages).toHaveLength(0)
    expect(nextCursor).toBe('42')
  })

  it('sendMessage posts text + inline buttons and returns externalSentMessageId', async () => {
    sendMessage.mockResolvedValue({ message_id: 99 })
    const result = await adapter.sendMessage({
      botCredentials: credentials,
      recipientId: '7',
      chatContextId: '7',
      messageBody: 'Approve this?',
      messageStructure: {
        replyToExternalMessageId: '5',
        inlineButtons: [
          { label: '✅ Approve', payload: 'approval:approve:a1' },
          { label: '❌ Deny', payload: 'approval:deny:a1' },
        ],
      },
    })
    expect(result.externalSentMessageId).toBe('99')
    const [chatId, text, extra] = sendMessage.mock.calls[0]!
    expect(chatId).toBe('7')
    expect(text).toBe('Approve this?')
    expect(extra.reply_parameters).toEqual({ message_id: 5 })
    expect(extra.reply_markup.inline_keyboard[0]).toHaveLength(2)
    expect(extra.reply_markup.inline_keyboard[0][0]).toEqual({
      text: '✅ Approve',
      callback_data: 'approval:approve:a1',
    })
  })

  it('editMessage calls editMessageText with the numeric message id', async () => {
    editMessageText.mockResolvedValue(true)
    await adapter.editMessage({
      botCredentials: credentials,
      chatContextId: '7',
      externalMessageId: '99',
      newMessageBody: 'updated',
    })
    expect(editMessageText).toHaveBeenCalledWith('7', 99, undefined, 'updated')
  })
})
