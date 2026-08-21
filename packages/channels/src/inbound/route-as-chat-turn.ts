// The channel turn routes by the channel's OWN SCOPE. A GLOBAL channel (no
// workspace) runs a global-root turn — the brain-tree Ch4 dispatcher vision,
// unchanged. A channel BOUND to a workspace runs on that workspace's continuing
// conversation instead, through the injected workspace runner: Ch4 had made the
// bound workspace inert, so a Telegram bot the user pointed at "letterman" still
// answered from the global brain (Kafi, live 2026-08-21). Either way the turn
// carries the ORIGIN channel, so the reply — and any delegation's report — come
// back HERE.
//
// TOOL-ONLY REPLIES (channel pipeline, Chad locked 2026-07-27, NARROWED
// 2026-08-22): the turn's chat text is NEVER auto-shipped to the channel WHILE
// the turn has replied through the tool — the model replies by CALLING
// reply_to_channel (the per-message marker instructs it every turn; the
// server-stamped origin addresses it). That much is unchanged, byte for byte.
//
// What changed is the OTHER half. "A turn that answers nothing sends nothing"
// was deliberate, but it also covered turns that answered nothing by accident:
// the SDK classifier refusing a tool, an approval timing out, the model writing
// text and stopping (agent B's GAP 3). The sender saw "typing…" stop and then
// silence, with no way to tell a refusal from a crash. Such a turn now ships ONE
// honest line (`shipSilentTurnFallback`). A delegation's report still follows
// later — and now travels to the REQUESTER, who answers the channel itself
// (channel report protocol).
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
import { resolveChannelTurnScope } from './resolve-channel-turn-scope.js'
import { shipSilentChannelTurnFallback } from './ship-silent-turn-fallback.js'
import type { Database } from '@vynel/db'
import type { Channel, ChannelInboundMessage } from '../repositories/index.js'
import type {
  BotCredentials,
  ChannelTurnRequest,
  ProcessInboundDeps,
} from '../channels-types.js'

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
    // ONE request shape, whichever conversation answers it.
    const turnRequest: ChannelTurnRequest = {
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
    }

    // Surface decides the scope: the channel's own `workspaceId` picks the
    // conversation. A workspace channel resumes that workspace's continuing
    // thread (its lock, its identity); a global one keeps the root.
    const runWorkspaceTurn = deps.runWorkspaceTurn
    const scope = resolveChannelTurnScope(
      db,
      { channel: input.channel, canRunWorkspaceTurn: runWorkspaceTurn !== undefined },
      deps.logger !== undefined ? { logger: deps.logger } : {},
    )
    // Read BEFORE the turn: every reply queued from here on is this turn's.
    const turnStartedAt = new Date()
    const turnResult =
      scope.kind === 'workspace' && runWorkspaceTurn !== undefined
        ? await runWorkspaceTurn(db, {
            ...turnRequest,
            workspaceId: scope.workspaceId,
            workspacePath: scope.workspacePath,
          })
        : await deps.runRootTurn(db, turnRequest)
    // NO CAPTURE while the turn HAS replied: the model spoke through
    // reply_to_channel and its chat text stays where it is. The old resultText
    // enqueue was the channel's harvest — it dressed the model's whole chat
    // answer as the reply and sent it whether the model meant to send it or
    // not; that is what stays dead. Only a turn that queued NOTHING for this
    // conversation falls through to the fallback line. Best-effort: a completed
    // turn is never failed over its own courtesy note.
    try {
      const shipped = shipSilentChannelTurnFallback(
        db,
        {
          channel: input.channel,
          message: input.message,
          resultText: turnResult.resultText,
          turnStartedAt,
          isGroupOrigin,
        },
        deps.logger !== undefined ? { logger: deps.logger } : {},
      )
      if (!shipped && turnResult.resultText.trim() !== '') {
        deps.logger?.info(
          {
            channelId: input.channel.id,
            scope: scope.kind,
            resultTextLength: turnResult.resultText.length,
          },
          'channel turn replied via the tool — its chat text was NOT delivered (tool-only replies)',
        )
      }
    } catch (fallbackErr) {
      deps.logger?.warn(
        { error: extractErrorMessage(fallbackErr), channelId: input.channel.id },
        'silent-turn fallback failed to enqueue (the turn itself succeeded)',
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
