// Telegram wire shapes + the pure normalization helpers the adapter maps
// them through. Split from `telegram-channel-adapter.ts` (which keeps the
// API client + the ChannelAdapter methods) purely by size — one wire
// vocabulary, one adapter, two files.

import type { NormalizedGroupSighting } from '../channel-adapter.js'

export interface TelegramUser {
  id: number
  first_name: string
  username?: string
}

export interface TelegramChat {
  id: number
  // 'private' | 'group' | 'supergroup' | 'channel' (Bot API chat.type).
  type?: string
  title?: string
}

export interface TelegramInboundMessage {
  message_id: number
  from?: TelegramUser
  chat: TelegramChat
  text?: string
  date: number
  // Addressing inputs: entities locate '@handle' / '/cmd@handle' substrings
  // in `text`; reply_to_message identifies a reply to the bot's own message.
  entities?: { type: string; offset: number; length: number }[]
  reply_to_message?: { from?: TelegramUser }
}

export interface TelegramCallbackQuery {
  id: string
  from: TelegramUser
  message?: { message_id: number; chat: TelegramChat }
  data?: string
}

// The bot's own membership changed (added/removed) — a SERVICE update,
// delivered regardless of bot privacy mode. The reliable group-discovery
// signal: privacy-mode bots never receive a plain "@bot …" group text.
export interface TelegramMyChatMemberUpdate {
  chat: TelegramChat
  new_chat_member?: { status?: string }
}

export interface TelegramUpdate {
  update_id: number
  message?: TelegramInboundMessage
  callback_query?: TelegramCallbackQuery
  my_chat_member?: TelegramMyChatMemberUpdate
}

// Telegram 'private' chats are DMs; group/supergroup (and broadcast
// 'channel' posts, which behave like rooms) are group contexts. An absent
// type (older payload shapes) reads as a DM — the pre-groups behavior.
export function describeChatContext(chat: TelegramChat): {
  chatContextKind: 'dm' | 'group'
  chatContextTitle: string | null
} {
  const isGroup = chat.type !== undefined && chat.type !== 'private'
  return {
    chatContextKind: isGroup ? 'group' : 'dm',
    chatContextTitle: chat.title ?? null,
  }
}

// A group message addresses the bot when it @mentions its handle or sends
// a command addressed to it (`/plan@handle`) — both located via entities,
// not a raw substring scan, so "email@bot.dev" never counts — or replies
// to one of the bot's own messages. Commands + replies matter doubly:
// they're the only texts a privacy-mode group bot receives at all. The
// suffix match is safe because `expectedMention` includes the leading '@'
// and Telegram usernames cannot contain '@' — another bot's handle can
// never end with it.
export function isBotAddressed(
  message: TelegramInboundMessage,
  botIdentity: { externalId: string; handle: string } | undefined,
): boolean {
  if (!botIdentity) return false
  if (
    message.reply_to_message?.from &&
    String(message.reply_to_message.from.id) === botIdentity.externalId
  ) {
    return true
  }
  if (message.text === undefined || botIdentity.handle === '') return false
  const expectedMention = `@${botIdentity.handle.toLowerCase()}`
  for (const entity of message.entities ?? []) {
    const sliced = message.text
      .slice(entity.offset, entity.offset + entity.length)
      .toLowerCase()
    if (entity.type === 'mention' && sliced === expectedMention) return true
    if (entity.type === 'bot_command' && sliced.endsWith(expectedMention)) return true
  }
  return false
}

// A my_chat_member update whose new status means "the bot is IN this group"
// becomes a group sighting; left/kicked (and DM chats) are not sightings.
const IN_GROUP_MEMBER_STATUSES = new Set(['member', 'administrator', 'restricted'])

export function deriveGroupSighting(
  update: TelegramMyChatMemberUpdate,
): NormalizedGroupSighting | null {
  const context = describeChatContext(update.chat)
  if (context.chatContextKind !== 'group') return null
  const status = update.new_chat_member?.status
  if (status === undefined || !IN_GROUP_MEMBER_STATUSES.has(status)) return null
  return {
    externalChatContextId: String(update.chat.id),
    chatContextTitle: context.chatContextTitle,
  }
}
