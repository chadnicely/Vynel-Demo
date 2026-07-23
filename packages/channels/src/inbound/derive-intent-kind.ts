// Pure classifier: maps an inbound message body to its `InboundIntentKind`.
// Only called for ALLOWED senders (non-allowed senders are stored as
// 'ignored' by the polling tick regardless of body). Never returns
// 'ignored' itself.
//
// Spec: `docs/blueprints/channels/blueprint.md §5.3`–§5.7.

import type { InboundIntentKind } from '../repositories/index.js'

export function deriveIntentKind(
  messageBody: string,
  chatContextKind: 'dm' | 'group' = 'dm',
): InboundIntentKind {
  const trimmed = messageBody.trim()
  // Slash commands (/help, /status, /new) — Phase 1.5 handlers; classified
  // now. IN A GROUP a command is just addressed speech: `/ask@bot …` is one
  // of the only two texts a privacy-mode bot receives at all, and the
  // channel-command handler is a no-op — routing it as a chat turn is the
  // difference between an answer and silence (channels-groups.md fix round).
  if (trimmed.startsWith('/')) {
    return chatContextKind === 'group' ? 'chat-turn' : 'channel-command'
  }
  // Inline-button callback payloads carry an explicit prefix (§5.7).
  if (trimmed.startsWith('approval:')) return 'approval-reply'
  // Typed approval replies: "approve" / "deny <reason>".
  if (/^(approve|deny)\b/i.test(trimmed)) return 'approval-reply'
  return 'chat-turn'
}
