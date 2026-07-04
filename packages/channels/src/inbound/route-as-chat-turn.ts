// The channel turn routes to the GLOBAL ROOT (brain-tree Ch4 — the dispatcher vision). A channel
// message no longer runs against the channel's bound workspace; instead it runs a global-root turn
// (via the injected runner), carrying the ORIGIN channel so the root's reply — and any delegation's
// report — come back HERE. The root either answers directly or delegates to a workspace; either
// way its answer text is delivered as the channel reply now, and a delegation's report follows
// later (the claim-and-run tick, Ch4 Step 3).
//
// The api-side service has no request context, so `runRootTurn` (wrapping runGlobalRootTurn) is
// INJECTED via `deps` — keeps apps/api + the orchestration runner out of packages/core. Session
// continuity is the runner's job (`resolveGlobalRootConversationTarget` — the per-user root), NOT
// the channel-session lookup, so an existing channel→workspace session simply orphans (one-time).
//
// Spec: `.claude/ceo/agent-base/chapter4-channel-aware-io.md`.

import { enqueueChannelReply } from '../delivery/enqueue-channel-reply.js'
import { resolveChannelAdapter } from '../adapters/channel-adapter-registry.js'
import { extractErrorMessage } from '../adapters/extract-error-message.js'
import type { Database } from '@vynel/db'
import type { Channel, ChannelInboundMessage } from '../repositories/index.js'
import type { BotCredentials, ProcessInboundDeps } from '../channels-types.js'

// Telegram's "typing…" action lasts ~5s — refresh just under that so the indicator stays continuous.
const TYPING_REFRESH_MS = 4_000

export async function routeAsChatTurn(
  db: Database,
  input: { channel: Channel; message: ChannelInboundMessage },
  deps: ProcessInboundDeps,
): Promise<void> {
  // The origin channel (Ch4) — threaded onto the root turn so its reply + any delegation report
  // come back to who asked, in the conversation they asked from.
  const origin = {
    channelId: input.channel.id,
    externalSenderId: input.message.externalSenderId,
    externalChatContextId: input.message.externalChatContextId,
  }

  // "Bot is typing…" while the root works — best-effort, never fails the turn. Refreshed on a
  // timer because Telegram's action expires after ~5s.
  const adapter = resolveChannelAdapter(input.channel.channelKind)
  let typingTimer: ReturnType<typeof setInterval> | undefined
  if (adapter.supportsTypingIndicator()) {
    const botCredentials = JSON.parse(input.channel.botCredentials) as BotCredentials
    const chatContextId = input.message.externalChatContextId
    const sendTyping = (): void => {
      void adapter
        .sendTypingIndicator({ botCredentials, chatContextId })
        .catch((err) =>
          deps.logger?.warn({ error: extractErrorMessage(err) }, 'channel typing indicator failed'),
        )
    }
    sendTyping() // immediately, then keep it alive for the turn's duration
    typingTimer = setInterval(sendTyping, TYPING_REFRESH_MS)
  }

  try {
    // Run the global-root turn (serialized per user by the runner's lock). The root answers
    // directly or delegates (carrying the origin); its answer is the reply we deliver now.
    const rootTurnResult = await deps.runRootTurn(db, {
      userId: input.channel.userId,
      userMessageText: input.message.messageBody,
      origin,
    })
    // Deliver the root's answer — the direct reply, or its "handed it off" ack if it delegated (the
    // delegation's report follows later via the claim-and-run tick). Skip an empty answer.
    if (rootTurnResult.resultText.trim() !== '') {
      enqueueChannelReply(db, {
        channel: input.channel,
        message: input.message,
        body: rootTurnResult.resultText,
      })
    }
  } finally {
    if (typingTimer !== undefined) clearInterval(typingTimer)
  }
}
