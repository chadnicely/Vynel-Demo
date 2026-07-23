// User-scoped core op — rename a channel (`displayName`), authorized by
// userId (the tenant boundary) so a global (null-workspace) channel is
// reachable from the user-scoped surface. The write + its
// `channel.renamed` outbox event co-commit in one transaction; an
// ownership miss throws before anything is written, so nothing is
// emitted. Mirrors `setChannelEnabledForUser`.

import { randomUUID } from 'node:crypto'
import { withTransaction, type Database } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { getChannelForUserOrThrow } from '../queries/get-channel-for-user.js'
import * as channelsRepository from '../repositories/index.js'
import type { Channel } from '../repositories/index.js'
import { CHANNEL_RENAMED, type ChannelRenamedPayload } from '../channels-events.js'

export function renameChannelForUser(
  db: Database,
  input: { channelId: string; userId: string; displayName: string },
): Channel {
  const channel = getChannelForUserOrThrow(db, input.channelId, input.userId)
  return withTransaction(db, (tx) => {
    const updated = channelsRepository.updateChannel(tx, channel.id, {
      displayName: input.displayName,
    })
    const payload: ChannelRenamedPayload = {
      channelId: updated.id,
      userId: updated.userId,
      workspaceId: updated.workspaceId,
      channelKind: updated.channelKind,
      displayName: updated.displayName,
      renamedAt: updated.updatedAt.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: CHANNEL_RENAMED,
      payload,
      createdAt: updated.updatedAt,
      processedAt: null,
    })
    return updated
  })
}
