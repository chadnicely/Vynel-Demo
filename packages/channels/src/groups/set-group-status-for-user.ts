// User-scoped core op — approve or ignore a discovered group (the Manage
// dialog's decision on a pending room; also re-approves an ignored one or
// revokes an approved one). The write + its `channel.group-status-changed`
// outbox event co-commit in one transaction; an ownership miss (channel OR
// group) throws before anything is written.

import { randomUUID } from 'node:crypto'
import { withTransaction, type Database } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { NotFoundError } from '@vynel/errors'
import { getChannelForUserOrThrow } from '../queries/get-channel-for-user.js'
import * as channelsRepository from '../repositories/index.js'
import type { ChannelChatGroup } from '../repositories/index.js'
import {
  CHANNEL_GROUP_STATUS_CHANGED,
  type ChannelGroupStatusChangedPayload,
} from '../channels-events.js'

export function setGroupStatusForUser(
  db: Database,
  input: {
    channelId: string
    userId: string
    groupId: string
    status: 'approved' | 'ignored'
  },
): ChannelChatGroup {
  const channel = getChannelForUserOrThrow(db, input.channelId, input.userId)
  const group = channelsRepository.findChannelChatGroupById(db, input.groupId)
  // The group must belong to THIS channel — an id from another channel is
  // the same 404 as a missing one (no cross-channel probing).
  if (group === null || group.channelId !== channel.id) {
    throw new NotFoundError('channel group', input.groupId)
  }
  return withTransaction(db, (tx) => {
    const now = new Date()
    const updated = channelsRepository.updateChannelChatGroup(tx, group.id, {
      status: input.status,
      // approvedAt records the LAST approval; revoking (ignore) keeps it as history.
      ...(input.status === 'approved' ? { approvedAt: now } : {}),
    })
    const payload: ChannelGroupStatusChangedPayload = {
      channelId: channel.id,
      userId: channel.userId,
      workspaceId: channel.workspaceId,
      channelKind: channel.channelKind,
      groupId: updated.id,
      externalChatContextId: updated.externalChatContextId,
      status: updated.status,
      changedAt: now.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: CHANNEL_GROUP_STATUS_CHANGED,
      payload,
      createdAt: now,
      processedAt: null,
    })
    return updated
  })
}
