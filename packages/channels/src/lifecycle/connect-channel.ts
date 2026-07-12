// Core op — connect a channel: verify the bot credentials over the network
// (via the adapter) BEFORE persisting anything, then insert the channel +
// optional first allowed sender + the `channel.connected` outbox event in
// one sync transaction (invariant: every state change co-commits its
// outbox event). The event payload is loose-ref facts only — NEVER the
// bot credentials.
//
// async (the credential verify is a network call); the tx callback itself
// is sync — better-sqlite3 rejects async tx callbacks
// (`.claude/memory/decisions/phase-1-sync-transactions.md`).
//
// Spec: `docs/blueprints/channels/blueprint.md §5.2`.

import { randomUUID } from 'node:crypto'
import { withTransaction, type Database } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import * as channelsRepository from '../repositories/index.js'
import { ValidationError } from '@vynel/errors'
import { CHANNEL_CONNECTED, type ChannelConnectedPayload } from '../channels-events.js'
import { resolveChannelAdapter } from '../adapters/channel-adapter-registry.js'
import type { Channel, ChannelKind } from '../repositories/index.js'
import type { BotCredentials, StructuralLogger } from '../channels-types.js'

export interface ConnectChannelInput {
  userId: string
  workspaceId: string | null // null = GLOBAL scope (no workspace); a value scopes to that workspace
  channelKind: ChannelKind
  displayName: string
  botCredentials: BotCredentials
  initialAllowedSenderId?: string
}

export async function connectChannel(
  db: Database,
  input: ConnectChannelInput,
  deps: { logger?: StructuralLogger } = {},
): Promise<Channel> {
  const adapter = resolveChannelAdapter(input.channelKind) // throws for 'discord' in Phase 1

  // 1. Verify credentials (network) BEFORE persisting anything.
  const verification = await adapter.verifyCredentials({ botCredentials: input.botCredentials })
  if (verification.kind !== 'valid') {
    throw new ValidationError(
      `Could not connect this ${input.channelKind} bot: ${verification.reasonMessage}. ` +
        `Check the bot token and try again.`,
    )
  }

  // 2. Persist — sync transaction callback.
  const now = new Date()
  const channel = withTransaction(db, (tx) => {
    const inserted = channelsRepository.insertChannel(tx, {
      id: randomUUID(),
      userId: input.userId,
      workspaceId: input.workspaceId,
      channelKind: input.channelKind,
      displayName: input.displayName,
      botCredentials: JSON.stringify(input.botCredentials),
      botMetadata: JSON.stringify(verification.botMetadata),
      connectionStatus: 'healthy',
      connectionStatusMessage: null,
      lastPolledCursor: null,
      lastPolledAt: null,
      lastInboundAt: null,
      isEnabled: true,
      createdAt: now,
      updatedAt: now,
    })
    if (input.initialAllowedSenderId) {
      channelsRepository.insertAllowedSender(tx, {
        id: randomUUID(),
        channelId: inserted.id,
        externalSenderId: input.initialAllowedSenderId,
        externalSenderHandle: null,
        externalSenderDisplayName: null,
        scopeContextId: input.initialAllowedSenderId, // Telegram DM: equals user ID
        addedAt: now,
      })
    }

    // Outbox co-commit — same transaction as the insert.
    const payload: ChannelConnectedPayload = {
      channelId: inserted.id,
      userId: inserted.userId,
      workspaceId: inserted.workspaceId,
      channelKind: inserted.channelKind,
      connectedAt: inserted.createdAt.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: CHANNEL_CONNECTED,
      payload,
      createdAt: now,
      processedAt: null,
    })

    return inserted
  })

  deps.logger?.info(
    { channelId: channel.id, channelKind: channel.channelKind },
    'channel connected',
  )
  return channel
}
