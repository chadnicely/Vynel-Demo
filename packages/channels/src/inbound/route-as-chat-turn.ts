// The channel turn routes to the GLOBAL ROOT (brain-tree Ch4 — the dispatcher vision). A channel
// message no longer runs against the channel's bound workspace; instead it runs a global-root turn
// (via the injected runner), carrying the ORIGIN channel so the root's reply — and any delegation's
// report — come back HERE.
//
// TOOL-ONLY REPLIES (channel pipeline, Chad locked 2026-07-27): the turn's chat
// text is NEVER captured and shipped to the channel — the model replies by
// CALLING reply_to_channel (the per-message marker instructs it every turn; the
// server-stamped origin addresses it). A turn that answers nothing sends
// nothing — deliberate, like the session-comms no-harvest rule. A delegation's
// report still follows later (the claim-and-run tick, Ch4 Step 3).
//
// The api-side service has no request context, so `runRootTurn` (wrapping runGlobalRootTurn) is
// INJECTED via `deps` — keeps apps/api + the orchestration runner out of packages/core. Session
// continuity is the runner's job (`resolveGlobalRootConversationTarget` — the per-user root), NOT
// the channel-session lookup, so an existing channel→workspace session simply orphans (one-time).
//
// Spec: `.claude/ceo/agent-base/chapter4-channel-aware-io.md`.

import { enqueueChannelStatus } from '../delivery/enqueue-channel-status.js'
import { enqueueApprovalRequest } from '../delivery/enqueue-approval-request.js'
import { resolveChannelAdapter } from '../adapters/channel-adapter-registry.js'
import { extractErrorMessage } from '../adapters/extract-error-message.js'
import { readInboundContext, describeSender } from './read-inbound-context.js'
import { composeChannelTurnMarker } from './compose-channel-turn-marker.js'
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
  // Group awareness (channels-groups.md): in a room, the model AND the
  // transcript must know WHO asked — the owner's brain serves the whole
  // room, so a group turn opens with a speaker line. DMs are unchanged.
  const context = readInboundContext(input.message)
  const isGroupOrigin = context.chatContextKind === 'group'
  const speakerLine = isGroupOrigin
    ? `[Group message from ${describeSender(input.message, context)} in ${
        context.chatContextTitle !== null ? `"${context.chatContextTitle}"` : 'a group chat'
      }]\n\n`
    : ''

  // The origin channel (Ch4) — threaded onto the root turn so its reply (the
  // reply_to_channel tool) + any delegation report come back to who asked, in
  // the conversation they asked from. Group messages carry the asking
  // message's id so the tool reply threads onto it.
  const origin = {
    channelId: input.channel.id,
    externalSenderId: input.message.externalSenderId,
    externalChatContextId: input.message.externalChatContextId,
    ...(isGroupOrigin ? { externalMessageId: input.message.externalMessageId } : {}),
  }

  // The per-message reply instruction (the voice-turn-marker precedent) —
  // provider input only; the runner keeps the persisted row clean.
  const channelReplyMarker = composeChannelTurnMarker({
    channelKind: input.channel.channelKind,
    group: isGroupOrigin
      ? {
          senderDescription: describeSender(input.message, context),
          title: context.chatContextTitle,
        }
      : null,
  })

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
    // Run the global-root turn (serialized per user by the runner's lock). The
    // root replies via reply_to_channel — or delegates, carrying the origin.
    const rootTurnResult = await deps.runRootTurn(db, {
      userId: input.channel.userId,
      userMessageText: speakerLine + input.message.messageBody,
      origin,
      channelReplyMarker,
      // The persisted user row records HOW this arrived ("via Telegram").
      originChannel: input.channel.channelKind,
      // Surface-up: the brain's own carded tool (e.g. register_workspace) records its
      // approval in the core (web notifier) and PARKS the turn — push the card back to
      // the sender too, with full inbound context (reply-to + typed-reply correlation).
      // Best-effort: a push failure narrows the surface to web, never fails the turn.
      // NEVER into a group (Chad's decision 3, channels-groups.md): any room
      // member could tap a button posted there — the card stays app-only.
      onApprovalRequested: (approval) => {
        if (isGroupOrigin) {
          deps.logger?.info(
            { approvalRequestId: approval.approvalRequestId, channelId: input.channel.id },
            'group-origin approval kept app-only (never posted into a group)',
          )
          return
        }
        try {
          enqueueApprovalRequest(db, {
            channel: input.channel,
            inboundMessage: input.message,
            card: approval,
          })
        } catch (err) {
          deps.logger?.warn(
            { error: extractErrorMessage(err), approvalRequestId: approval.approvalRequestId },
            'channel approval push failed (the web notifier still has the card)',
          )
        }
      },
    })
    // NO CAPTURE: the turn's chat text is never shipped to the channel — the
    // model replied through reply_to_channel (or chose not to reply). The old
    // resultText enqueue was the channel's harvest; it dressed the model's
    // whole chat answer as the reply and sent it whether the model meant to
    // send it or not. Logged so a "Telegram went silent" report is diagnosable
    // without reading the transcript: text + no tool call = deliberate policy.
    if (rootTurnResult.resultText.trim() !== '') {
      deps.logger?.info(
        { channelId: input.channel.id, resultTextLength: rootTurnResult.resultText.length },
        'channel turn completed with chat text — NOT delivered (replies travel only via reply_to_channel)',
      )
    }
  } catch (err) {
    // The turn failed. Without a reply the sender just watches "typing…" stop and
    // sees silence — so enqueue a brief user-facing apology for the delivery tick
    // to ship, THEN re-throw so processInboundMessage still marks the inbound row
    // failed + logs the scrubbed error (report-up unchanged).
    enqueueChannelStatus(
      db,
      { channel: input.channel, message: input.message },
      'Sorry — I hit an error handling that. Please try again.',
    )
    throw err
  } finally {
    if (typingTimer !== undefined) clearInterval(typingTimer)
  }
}
