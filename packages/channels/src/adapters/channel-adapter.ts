// The abstract `ChannelAdapter` contract — one abstract class, one
// concrete per channel kind. Mirrors `AiAgentProvider`
// (`packages/providers/src/shared/ai-agent-provider.ts`): real from day
// one, concrete implementations resolved via the registry. Phase 1 ships
// only `TelegramChannelAdapter`.
//
// Spec: `docs/blueprints/channels/blueprint.md §5.1`.

import type { ChannelKind } from '../repositories/index.js'

export type BotCredentials = Record<string, string>

export type VerifyCredentialsResult =
  | {
      kind: 'valid'
      botDisplayName: string
      botHandle: string
      botMetadata: Record<string, unknown>
    }
  | { kind: 'invalid'; reasonMessage: string }

export interface NormalizedInboundMessage {
  externalMessageId: string
  externalSenderId: string
  externalSenderHandle: string | null
  externalSenderDisplayName: string | null
  externalChatContextId: string
  messageBody: string
  messageMetadata: Record<string, unknown>
  receivedAt: Date
}

export interface NormalizedMessageStructure {
  inlineButtons?: { label: string; payload: string }[]
  replyToExternalMessageId?: string
  parseMode?: 'plain' | 'markdown'
}

export abstract class ChannelAdapter {
  abstract readonly channelKind: ChannelKind

  abstract verifyCredentials(input: {
    botCredentials: BotCredentials
  }): Promise<VerifyCredentialsResult>

  abstract pollForInboundMessages(input: {
    channelId: string
    botCredentials: BotCredentials
    sinceCursor?: string // opaque per-kind cursor (Telegram update offset)
  }): Promise<{ messages: NormalizedInboundMessage[]; nextCursor: string }>

  abstract sendMessage(input: {
    botCredentials: BotCredentials
    recipientId: string
    chatContextId: string
    messageBody: string
    messageStructure: NormalizedMessageStructure
  }): Promise<{ externalSentMessageId: string }>

  // No Phase 1 core consumer — the only caller is the Phase 1.5
  // streaming-look path (edit a placeholder with each chunk; D7). Kept on
  // the contract now so that work is purely additive. Throws if the kind
  // doesn't support editing.
  abstract editMessage(input: {
    botCredentials: BotCredentials
    chatContextId: string
    externalMessageId: string
    newMessageBody: string
  }): Promise<void>

  // Ephemeral "the bot is typing…" signal, shown while a channel turn is
  // generating. Best-effort + short-lived (Telegram's action lasts ~5s), so
  // the caller re-sends it on a timer for the duration of the turn. Never
  // queued (it carries no content) and never fails a turn — fire-and-forget.
  abstract sendTypingIndicator(input: {
    botCredentials: BotCredentials
    chatContextId: string
  }): Promise<void>

  abstract supportsInlineButtons(): boolean
  abstract supportsMessageEditing(): boolean
  abstract supportsTypingIndicator(): boolean
}
