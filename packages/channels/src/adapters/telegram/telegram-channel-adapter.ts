// `TelegramChannelAdapter` — the only concrete `ChannelAdapter` in
// Phase 1. Wraps `telegraf`'s `Telegram` API client: getMe (verify),
// getUpdates (poll, cursor = update offset), sendMessage (replies +
// approval inline keyboards), editMessageText (Phase 1.5 streaming look).
//
// Spec: `docs/blueprints/channels/blueprint.md §5.1` + `coding.md §4`.
//
// telegraf's `Update` type is a deep discriminated union; rather than
// fight it under strict TS, we cast the `Telegram` instance to a minimal
// `TelegramApiClient` facade describing exactly the subset of the v4 Bot
// API this adapter uses. ONE boundary cast isolates the external SDK and
// keeps the mocked test (network boundary, not DB) aligned to this shape.

import { Telegram } from 'telegraf'
import { ChannelAdapter } from '../channel-adapter.js'
import { extractErrorMessage } from '../extract-error-message.js'
import {
  describeChatContext,
  isBotAddressed,
  deriveGroupSighting,
} from './telegram-normalization.js'
import type { TelegramUser, TelegramUpdate } from './telegram-normalization.js'
import type {
  BotCredentials,
  VerifyCredentialsResult,
  NormalizedInboundMessage,
  NormalizedGroupSighting,
  NormalizedMessageStructure,
} from '../channel-adapter.js'
import type { ChannelKind } from '../../repositories/index.js'

interface TelegramSendExtra {
  parse_mode?: 'Markdown'
  reply_parameters?: { message_id: number }
  reply_markup?: { inline_keyboard: { text: string; callback_data: string }[][] }
}

// The minimal subset of telegraf's `Telegram` API this adapter uses
// (verified against telegraf v4). The single boundary cast below maps the
// real instance onto it.
interface TelegramApiClient {
  getMe(): Promise<TelegramUser>
  getUpdates(
    timeout: number,
    limit: number,
    offset: number,
    allowedUpdates?: readonly string[],
  ): Promise<TelegramUpdate[]>
  sendMessage(
    chatId: string | number,
    text: string,
    extra?: TelegramSendExtra,
  ): Promise<{ message_id: number }>
  editMessageText(
    chatId: string | number,
    messageId: number,
    inlineMessageId: undefined,
    text: string,
  ): Promise<unknown>
  sendChatAction(chatId: string | number, action: 'typing'): Promise<unknown>
}

export class TelegramChannelAdapter extends ChannelAdapter {
  readonly channelKind: ChannelKind = 'telegram'

  private client(botCredentials: BotCredentials): TelegramApiClient {
    return new Telegram(botCredentials.botToken ?? '') as unknown as TelegramApiClient
  }

  async verifyCredentials(input: {
    botCredentials: BotCredentials
  }): Promise<VerifyCredentialsResult> {
    try {
      const me = await this.client(input.botCredentials).getMe()
      return {
        kind: 'valid',
        botDisplayName: me.first_name,
        botHandle: me.username ?? '',
        botMetadata: { id: me.id, username: me.username ?? null, firstName: me.first_name },
      }
    } catch (err) {
      return { kind: 'invalid', reasonMessage: extractErrorMessage(err) }
    }
  }

  async pollForInboundMessages(input: {
    channelId: string
    botCredentials: BotCredentials
    sinceCursor?: string
    botIdentity?: { externalId: string; handle: string }
  }): Promise<{
    messages: NormalizedInboundMessage[]
    nextCursor: string
    groupSightings?: NormalizedGroupSighting[]
  }> {
    const offset = input.sinceCursor ? Number(input.sinceCursor) : 0
    const updates = await this.client(input.botCredentials).getUpdates(0, 100, offset, [
      'message',
      'callback_query',
      'my_chat_member',
    ])

    const messages: NormalizedInboundMessage[] = []
    const groupSightings: { externalChatContextId: string; chatContextTitle: string | null }[] = []
    let maxUpdateId = offset > 0 ? offset - 1 : 0
    for (const update of updates) {
      if (update.update_id > maxUpdateId) maxUpdateId = update.update_id

      // Bot added to a group → a sighting (works under privacy mode, where
      // a plain "@bot …" group text would never arrive).
      if (update.my_chat_member) {
        const sighting = deriveGroupSighting(update.my_chat_member)
        if (sighting) groupSightings.push(sighting)
        continue
      }

      // Text message → a normal inbound (chat turn / typed approval reply).
      const message = update.message
      if (message && typeof message.text === 'string') {
        const context = describeChatContext(message.chat)
        messages.push({
          externalMessageId: String(message.message_id),
          externalSenderId: message.from ? String(message.from.id) : '',
          externalSenderHandle: message.from?.username ?? null,
          externalSenderDisplayName: message.from?.first_name ?? null,
          externalChatContextId: String(message.chat.id),
          ...context,
          isBotMentioned:
            context.chatContextKind === 'dm' ||
            isBotAddressed(message, input.botIdentity),
          messageBody: message.text,
          messageMetadata: { date: message.date },
          receivedAt: new Date(message.date * 1000),
        })
        continue
      }

      // Inline-button tap → an inbound carrying the callback payload
      // (e.g. "approval:approve:<id>"). The synthetic externalMessageId
      // (`cbq:<id>`) keeps dedup working. The chat context falls back to
      // the sender id (Telegram DM) when the originating message is absent.
      // A tap on the bot's own button is inherently addressed to the bot.
      const callback = update.callback_query
      if (callback && typeof callback.data === 'string') {
        const context = callback.message
          ? describeChatContext(callback.message.chat)
          : { chatContextKind: 'dm' as const, chatContextTitle: null }
        messages.push({
          externalMessageId: `cbq:${callback.id}`,
          externalSenderId: String(callback.from.id),
          externalSenderHandle: callback.from.username ?? null,
          externalSenderDisplayName: callback.from.first_name ?? null,
          externalChatContextId: callback.message
            ? String(callback.message.chat.id)
            : String(callback.from.id),
          ...context,
          isBotMentioned: true,
          messageBody: callback.data,
          messageMetadata: { isCallback: true, callbackQueryId: callback.id },
          receivedAt: new Date(),
        })
      }
    }
    // Advance the cursor past the highest update we saw (Telegram confirms
    // updates < offset on the next poll). No updates → keep the prior cursor.
    const nextCursor = updates.length > 0 ? String(maxUpdateId + 1) : (input.sinceCursor ?? '0')
    return { messages, nextCursor, groupSightings }
  }

  async sendMessage(input: {
    botCredentials: BotCredentials
    recipientId: string
    chatContextId: string
    messageBody: string
    messageStructure: NormalizedMessageStructure
  }): Promise<{ externalSentMessageId: string }> {
    const extra: TelegramSendExtra = {}
    if (input.messageStructure.parseMode === 'markdown') extra.parse_mode = 'Markdown'
    if (input.messageStructure.replyToExternalMessageId) {
      extra.reply_parameters = {
        message_id: Number(input.messageStructure.replyToExternalMessageId),
      }
    }
    if (input.messageStructure.inlineButtons && input.messageStructure.inlineButtons.length > 0) {
      extra.reply_markup = {
        inline_keyboard: [
          input.messageStructure.inlineButtons.map((button) => ({
            text: button.label,
            callback_data: button.payload,
          })),
        ],
      }
    }
    const sent = await this.client(input.botCredentials).sendMessage(
      input.chatContextId,
      input.messageBody,
      extra,
    )
    return { externalSentMessageId: String(sent.message_id) }
  }

  async editMessage(input: {
    botCredentials: BotCredentials
    chatContextId: string
    externalMessageId: string
    newMessageBody: string
  }): Promise<void> {
    await this.client(input.botCredentials).editMessageText(
      input.chatContextId,
      Number(input.externalMessageId),
      undefined,
      input.newMessageBody,
    )
  }

  async sendTypingIndicator(input: {
    botCredentials: BotCredentials
    chatContextId: string
  }): Promise<void> {
    // Telegram's typing action auto-expires after ~5s; the caller re-sends
    // it on a timer for the duration of the turn.
    await this.client(input.botCredentials).sendChatAction(input.chatContextId, 'typing')
  }

  supportsInlineButtons(): boolean {
    return true
  }

  supportsMessageEditing(): boolean {
    return true
  }

  supportsTypingIndicator(): boolean {
    return true
  }
}
