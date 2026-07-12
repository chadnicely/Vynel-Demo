// Shared tx body for the two disconnect twins (workspace- and
// user-scoped): hard-delete the channel (cascades to child tables, D16)
// + co-commit the `channel.disconnected` outbox event in ONE
// transaction. The caller has already resolved ownership and holds the
// channel row — the event records what was severed from facts in hand
// (never the bot credentials the row carries).

import { randomUUID } from 'node:crypto'
import { withTransaction, type Database } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import * as channelsRepository from '../repositories/index.js'
import type { Channel } from '../repositories/index.js'
import { CHANNEL_DISCONNECTED, type ChannelDisconnectedPayload } from '../channels-events.js'

export function hardDeleteChannelWithEvent(db: Database, channel: Channel): void {
  const now = new Date()
  const payload: ChannelDisconnectedPayload = {
    channelId: channel.id,
    userId: channel.userId,
    workspaceId: channel.workspaceId,
    channelKind: channel.channelKind,
    disconnectedAt: now.toISOString(),
  }
  withTransaction(db, (tx) => {
    channelsRepository.hardDeleteChannel(tx, channel.id)
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: CHANNEL_DISCONNECTED,
      payload,
      createdAt: now,
      processedAt: null,
    })
  })
}
