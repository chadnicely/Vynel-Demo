// The SILENT-TURN fallback (channel report protocol, Kafi 2026-08-22 — agent
// B's GAP 3). A channel turn can end having said nothing to the sender at all:
// the SDK's own classifier refused a tool ahead of `canUseTool` (the row settles
// `blocked`, no Vynel card exists to approve), an approval timed out
// (`APPROVAL_TIMED_OUT_DENY_REASON`), or the model simply wrote chat text and
// stopped. None of those throw, so the route's apology never fires — the sender
// watches "typing…" stop and then gets silence.
//
// WHAT THIS NARROWS. The tool-only reply rule (Chad locked 2026-07-27) said the
// model's chat text is never shipped to a channel, because the old harvest
// dressed a whole chat answer as the reply whether the model meant to send it or
// not. That reasoning is about a turn that DID reply through the tool — the rule
// now reads "the model's text is never auto-shipped WHILE it has replied via the
// tool". A turn that replied keeps its exact shape, byte for byte. A turn that
// replied NOTHING owes the sender one honest line, and its own final text is the
// most honest line available.
//
// "Replied" is measured on the OUTBOUND QUEUE, not on the runner's return: it
// catches `send_to_channel` to the same conversation as well as
// `reply_to_channel`, and it cannot drift from what the sender actually receives.

import { enqueueChannelReply } from '../delivery/enqueue-channel-reply.js'
import { countChannelRepliesSince } from '../repositories/index.js'
import type { Database } from '@vynel/db'
import type { Channel, ChannelInboundMessage } from '../repositories/index.js'
import type { StructuralLogger } from '../channels-types.js'

/** The line a turn that produced no text at all sends. It names the common
 *  cause (a tool the classifier or an unanswered card refused) because that is
 *  what a wordless channel turn nearly always is — and it tells the sender the
 *  one thing they can do about it. */
export const SILENT_CHANNEL_TURN_FALLBACK =
  "I couldn't do that from here — it needs your OK in the app."

// Telegram caps a message at 4096 characters and rejects longer ones outright;
// no adapter splits today, so the fallback stays inside the tightest limit
// rather than trading silence for a delivery failure.
const CHANNEL_MESSAGE_LIMIT = 4096

function trimToChannelLimit(text: string): string {
  return text.length <= CHANNEL_MESSAGE_LIMIT
    ? text
    : `${text.slice(0, CHANNEL_MESSAGE_LIMIT - 1)}…`
}

export interface SilentChannelTurnFallbackInput {
  channel: Channel
  message: Pick<
    ChannelInboundMessage,
    'externalSenderId' | 'externalChatContextId' | 'externalMessageId'
  >
  /** The turn's own drained chat text — shipped when the turn said nothing else. */
  resultText: string
  /** The moment the turn began. A reply queued at or after it answers this turn. */
  turnStartedAt: Date
  /** Group rooms thread the line onto the asking message, like a tool reply. */
  isGroupOrigin: boolean
}

/** Ship ONE honest line when the turn replied nothing. Returns true if it did.
 *  Best-effort by contract: the caller must never fail a completed turn over it. */
export function shipSilentChannelTurnFallback(
  db: Database,
  input: SilentChannelTurnFallbackInput,
  deps: { logger?: StructuralLogger } = {},
): boolean {
  const repliesSent = countChannelRepliesSince(db, {
    channelId: input.channel.id,
    externalChatContextId: input.message.externalChatContextId,
    since: input.turnStartedAt,
  })
  if (repliesSent > 0) return false

  const spoken = input.resultText.trim()
  const body = spoken === '' ? SILENT_CHANNEL_TURN_FALLBACK : trimToChannelLimit(spoken)
  enqueueChannelReply(db, {
    channel: input.channel,
    message: input.message,
    body,
    ...(input.isGroupOrigin
      ? { replyToExternalMessageId: input.message.externalMessageId }
      : {}),
  })
  deps.logger?.warn(
    {
      channelId: input.channel.id,
      shippedModelText: spoken !== '',
    },
    'channel turn ended without replying — shipped the fallback line so the sender is not left silent',
  )
  return true
}
