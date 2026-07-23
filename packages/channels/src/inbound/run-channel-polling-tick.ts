// Core op — poll every enabled channel for inbound messages, dedup,
// allowlist-check, write inbound rows, and advance the per-channel
// `lastPolledCursor`. async (each adapter poll is a network call). One
// channel's failure must NOT abort the loop — per-channel try/catch
// downgrades that channel's status and continues.
//
// Spec: `docs/blueprints/channels/blueprint.md §5.3` + `coding.md §1.4`.

import { randomUUID } from 'node:crypto'
import { withTransaction } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import * as channelsRepository from '../repositories/index.js'
import { resolveChannelAdapter } from '../adapters/channel-adapter-registry.js'
import { extractErrorMessage } from '../adapters/extract-error-message.js'
import { deriveIntentKind } from './derive-intent-kind.js'
import {
  CHANNEL_GROUP_DISCOVERED,
  type ChannelGroupDiscoveredPayload,
} from '../channels-events.js'
import type { Database } from '@vynel/db'
import type { Channel, ChannelConnectionStatus } from '../repositories/index.js'
import type {
  StructuralLogger,
  BotCredentials,
  NormalizedInboundMessage,
} from '../channels-types.js'

function derivePollFailureStatus(message: string): ChannelConnectionStatus {
  if (/401|unauthor|forbidden|invalid token/i.test(message)) return 'auth-failed'
  if (/429|rate.?limit|too many/i.test(message)) return 'rate-limited'
  return 'network-error'
}

// The bot's own identity from the channel row's stored botMetadata (written
// at connect from verifyCredentials) — lets the adapter detect @mentions /
// replies-to-the-bot in groups. Malformed metadata degrades to null
// (mention detection off), never a thrown poll.
function deriveBotIdentity(channel: Channel): { externalId: string; handle: string } | null {
  try {
    const parsed = JSON.parse(channel.botMetadata) as { id?: unknown; username?: unknown }
    if (parsed.id === undefined || parsed.id === null) return null
    return {
      externalId: String(parsed.id),
      handle: typeof parsed.username === 'string' ? parsed.username : '',
    }
  } catch {
    return null
  }
}

// The ONE discovery home (message path + bot-added sightings): record an
// unknown room `pending` and co-commit the discovery event. The if-absent
// insert is the unique-index net: an overlapping tick's lost race degrades
// to "already recorded" (no event, no thrown poll). Returns whether a NEW
// row was recorded.
function recordGroupDiscovery(
  db: Database,
  channel: Channel,
  sighting: { externalChatContextId: string; title: string | null; seenAt: Date },
  logger: StructuralLogger | undefined,
): boolean {
  const discovered = withTransaction(db, (tx) => {
    const group = channelsRepository.insertChannelChatGroupIfAbsent(tx, {
      id: randomUUID(),
      channelId: channel.id,
      externalChatContextId: sighting.externalChatContextId,
      title: sighting.title,
      status: 'pending',
      memberPolicy: 'everyone',
      firstSeenAt: sighting.seenAt,
      lastInboundAt: sighting.seenAt,
      approvedAt: null,
    })
    if (group === null) return false
    const payload: ChannelGroupDiscoveredPayload = {
      channelId: channel.id,
      userId: channel.userId,
      workspaceId: channel.workspaceId,
      channelKind: channel.channelKind,
      groupId: group.id,
      externalChatContextId: group.externalChatContextId,
      title: group.title,
      discoveredAt: group.firstSeenAt.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: CHANNEL_GROUP_DISCOVERED,
      payload,
      createdAt: group.firstSeenAt,
      processedAt: null,
    })
    return true
  })
  if (discovered) {
    logger?.info(
      { channelId: channel.id, chatContextId: sighting.externalChatContextId },
      'channel group discovered (pending approval)',
    )
  }
  return discovered
}

// The group gate (channels-groups.md): resolves a group message against the
// channel's known groups. 'skip' = no inbound row at all; 'process' = run
// the normal per-sender allowlist (an approved group with 'allowlist'
// policy); 'process-allowed' = the room's approval IS the permission (an
// approved group with 'everyone' policy).
type GroupMessageVerdict = { kind: 'skip' | 'process' | 'process-allowed' }

function resolveGroupMessage(
  db: Database,
  channel: Channel,
  message: NormalizedInboundMessage,
  logger: StructuralLogger | undefined,
): GroupMessageVerdict {
  const existing = channelsRepository.findChannelChatGroup(db, {
    channelId: channel.id,
    externalChatContextId: message.externalChatContextId,
  })

  // First sight of this room → record it pending + co-commit the discovery
  // event. The triggering message itself is NOT enqueued — the pending
  // group card in the Manage dialog is the visible outcome.
  if (existing === null) {
    recordGroupDiscovery(
      db,
      channel,
      {
        externalChatContextId: message.externalChatContextId,
        title: message.chatContextTitle,
        seenAt: message.receivedAt,
      },
      logger,
    )
    return { kind: 'skip' }
  }

  // Keep the room's title + liveness fresh (a rename or new activity shows
  // in the Manage dialog without re-discovery). Liveness only ever moves
  // FORWARD — an out-of-order redelivery must not rewind it.
  const titleChanged =
    message.chatContextTitle !== null && message.chatContextTitle !== existing.title
  const advancesLiveness =
    existing.lastInboundAt === null || message.receivedAt > existing.lastInboundAt
  if (titleChanged || advancesLiveness) {
    channelsRepository.updateChannelChatGroup(db, existing.id, {
      ...(advancesLiveness ? { lastInboundAt: message.receivedAt } : {}),
      ...(titleChanged ? { title: message.chatContextTitle } : {}),
    })
  }

  if (existing.status !== 'approved') return { kind: 'skip' }
  // Mention gate (Chad's decision 2): in a room, only messages addressed to
  // the bot become turns. Room chatter is skipped, not stored.
  if (!message.isBotMentioned) return { kind: 'skip' }
  return existing.memberPolicy === 'everyone' ? { kind: 'process-allowed' } : { kind: 'process' }
}

export async function runChannelPollingTick(
  db: Database,
  deps: { logger?: StructuralLogger } = {},
): Promise<{ polledChannelCount: number; insertedMessageCount: number }> {
  const channels = channelsRepository.listEnabledChannels(db)
  let insertedMessageCount = 0

  for (const channel of channels) {
    try {
      const adapter = resolveChannelAdapter(channel.channelKind)
      const credentials = JSON.parse(channel.botCredentials) as BotCredentials
      const botIdentity = deriveBotIdentity(channel)
      const { messages, nextCursor, groupSightings } = await adapter.pollForInboundMessages({
        channelId: channel.id,
        botCredentials: credentials,
        ...(channel.lastPolledCursor !== null ? { sinceCursor: channel.lastPolledCursor } : {}),
        ...(botIdentity !== null ? { botIdentity } : {}),
      })

      // Bot-added sightings discover groups WITHOUT a routable message —
      // the privacy-mode-proof ritual (adding the bot is enough). Processed
      // before the messages so an add + mention in one batch discovers once.
      for (const sighting of groupSightings ?? []) {
        const known = channelsRepository.findChannelChatGroup(db, {
          channelId: channel.id,
          externalChatContextId: sighting.externalChatContextId,
        })
        if (known === null) {
          recordGroupDiscovery(
            db,
            channel,
            {
              externalChatContextId: sighting.externalChatContextId,
              title: sighting.chatContextTitle,
              seenAt: new Date(),
            },
            deps.logger,
          )
        } else if (
          sighting.chatContextTitle !== null &&
          sighting.chatContextTitle !== known.title
        ) {
          channelsRepository.updateChannelChatGroup(db, known.id, {
            title: sighting.chatContextTitle,
          })
        }
      }

      let lastInboundAt = channel.lastInboundAt
      for (const message of messages) {
        // Group gate FIRST (channels-groups.md): it may record a pending
        // group and may skip the message entirely — skipped group chatter
        // never becomes a row (a busy room must not flood the audit table).
        const groupVerdict =
          message.chatContextKind === 'group'
            ? resolveGroupMessage(db, channel, message, deps.logger)
            : { kind: 'process' as const }
        if (groupVerdict.kind === 'skip') continue

        // Explicit dedup (primary defense; the unique index is the net) — §1.4.
        if (channelsRepository.findInboundMessageByExternalId(db, channel.id, message.externalMessageId)) {
          continue
        }
        // DM: the sender's own link row (scope = DM chat id). Approved
        // group with 'allowlist' policy: the sender must hold a link row
        // scoped to THIS group. 'everyone' policy: the room's approval is
        // the permission.
        const isAllowed =
          groupVerdict.kind === 'process-allowed'
            ? true
            : channelsRepository.findAllowedSender(db, {
                channelId: channel.id,
                externalSenderId: message.externalSenderId,
                scopeContextId: message.externalChatContextId,
              }) !== null

        channelsRepository.insertInboundMessage(db, {
          id: randomUUID(),
          channelId: channel.id,
          externalMessageId: message.externalMessageId,
          externalSenderId: message.externalSenderId,
          externalChatContextId: message.externalChatContextId,
          messageBody: message.messageBody,
          // Sender + room facts ride the opaque metadata so the routing
          // slice can attribute group turns without an inbound-schema change.
          messageMetadata: JSON.stringify({
            ...message.messageMetadata,
            senderHandle: message.externalSenderHandle,
            senderDisplayName: message.externalSenderDisplayName,
            chatContextKind: message.chatContextKind,
            chatContextTitle: message.chatContextTitle,
          }),
          // Non-allowed senders are stored as 'ignored' for the audit trail.
          intentKind: isAllowed
            ? deriveIntentKind(message.messageBody, message.chatContextKind)
            : 'ignored',
          routedToChatSessionId: null,
          routedToApprovalRequestId: null,
          status: isAllowed ? 'pending' : 'ignored',
          statusMessage: null,
          receivedAt: message.receivedAt,
          processedAt: null,
        })
        insertedMessageCount++
        if (!lastInboundAt || message.receivedAt > lastInboundAt) lastInboundAt = message.receivedAt
      }

      channelsRepository.updateChannel(db, channel.id, {
        lastPolledCursor: nextCursor,
        lastPolledAt: new Date(),
        lastInboundAt,
        connectionStatus: 'healthy',
        connectionStatusMessage: null,
      })
    } catch (err) {
      const reason = extractErrorMessage(err)
      channelsRepository.updateChannel(db, channel.id, {
        connectionStatus: derivePollFailureStatus(reason),
        connectionStatusMessage: reason,
      })
      // Log the SCRUBBED message — a raw telegraf `err` can embed the bot
      // token in its request URL (coding.md §1.1 / Gate-3 C1).
      deps.logger?.warn({ error: reason, channelId: channel.id }, 'channel polling tick failed')
    }
  }

  return { polledChannelCount: channels.length, insertedMessageCount }
}
