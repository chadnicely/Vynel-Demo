// Reads the sender + room facts the polling tick stamped into an inbound
// row's opaque `messageMetadata` JSON (channels-groups.md — group
// attribution without an inbound-schema change). Tolerant by design:
// legacy rows (pre-groups) and malformed JSON read as a DM with no names —
// exactly the pre-groups behavior.

import type { ChannelInboundMessage } from '../repositories/index.js'

export interface InboundMessageContext {
  chatContextKind: 'dm' | 'group'
  chatContextTitle: string | null
  senderDisplayName: string | null
  senderHandle: string | null
}

export function readInboundContext(
  message: Pick<ChannelInboundMessage, 'messageMetadata'>,
): InboundMessageContext {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(message.messageMetadata) as Record<string, unknown>
  } catch {
    parsed = {}
  }
  return {
    chatContextKind: parsed.chatContextKind === 'group' ? 'group' : 'dm',
    chatContextTitle: typeof parsed.chatContextTitle === 'string' ? parsed.chatContextTitle : null,
    senderDisplayName:
      typeof parsed.senderDisplayName === 'string' ? parsed.senderDisplayName : null,
    senderHandle: typeof parsed.senderHandle === 'string' ? parsed.senderHandle : null,
  }
}

/** The human label for a group speaker: display name, else @handle, else the raw id. */
export function describeSender(
  message: Pick<ChannelInboundMessage, 'externalSenderId'>,
  context: InboundMessageContext,
): string {
  if (context.senderDisplayName !== null) return context.senderDisplayName
  if (context.senderHandle !== null) return `@${context.senderHandle.replace(/^@/, '')}`
  return message.externalSenderId
}
