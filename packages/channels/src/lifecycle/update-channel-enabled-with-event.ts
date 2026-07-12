// Shared tx body for the two enable-toggle twins (workspace- and
// user-scoped): flip `isEnabled` + co-commit the
// `channel.enabled-changed` outbox event in ONE transaction. The
// caller has already resolved ownership and holds the channel row.

import { randomUUID } from 'node:crypto'
import { withTransaction, type Database } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import * as channelsRepository from '../repositories/index.js'
import type { Channel } from '../repositories/index.js'
import { CHANNEL_ENABLED_CHANGED, type ChannelEnabledChangedPayload } from '../channels-events.js'

export function updateChannelEnabledWithEvent(
  db: Database,
  channel: Channel,
  isEnabled: boolean,
): Channel {
  return withTransaction(db, (tx) => {
    const updated = channelsRepository.updateChannel(tx, channel.id, { isEnabled })
    const payload: ChannelEnabledChangedPayload = {
      channelId: updated.id,
      userId: updated.userId,
      workspaceId: updated.workspaceId,
      channelKind: updated.channelKind,
      isEnabled: updated.isEnabled,
      changedAt: updated.updatedAt.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: CHANNEL_ENABLED_CHANGED,
      payload,
      createdAt: updated.updatedAt,
      processedAt: null,
    })
    return updated
  })
}
