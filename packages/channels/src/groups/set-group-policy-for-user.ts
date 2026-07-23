// User-scoped core op — flip an approved group's member policy (Chad's
// decision 1: 'everyone' trusts the room; 'allowlist' additionally requires
// a group-scoped allowed-sender row per member). Co-commits its
// `channel.group-policy-changed` outbox event; ownership misses throw
// before anything is written. Mirrors `setGroupStatusForUser`.

import { randomUUID } from 'node:crypto'
import { withTransaction, type Database } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { NotFoundError } from '@vynel/errors'
import { getChannelForUserOrThrow } from '../queries/get-channel-for-user.js'
import * as channelsRepository from '../repositories/index.js'
import type { ChannelChatGroup, ChannelGroupMemberPolicy } from '../repositories/index.js'
import {
  CHANNEL_GROUP_POLICY_CHANGED,
  type ChannelGroupPolicyChangedPayload,
} from '../channels-events.js'

export function setGroupPolicyForUser(
  db: Database,
  input: {
    channelId: string
    userId: string
    groupId: string
    memberPolicy: ChannelGroupMemberPolicy
  },
): ChannelChatGroup {
  const channel = getChannelForUserOrThrow(db, input.channelId, input.userId)
  const group = channelsRepository.findChannelChatGroupById(db, input.groupId)
  if (group === null || group.channelId !== channel.id) {
    throw new NotFoundError('channel group', input.groupId)
  }
  return withTransaction(db, (tx) => {
    const now = new Date()
    const updated = channelsRepository.updateChannelChatGroup(tx, group.id, {
      memberPolicy: input.memberPolicy,
    })
    const payload: ChannelGroupPolicyChangedPayload = {
      channelId: channel.id,
      userId: channel.userId,
      workspaceId: channel.workspaceId,
      channelKind: channel.channelKind,
      groupId: updated.id,
      externalChatContextId: updated.externalChatContextId,
      memberPolicy: updated.memberPolicy,
      changedAt: now.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: CHANNEL_GROUP_POLICY_CHANGED,
      payload,
      createdAt: now,
      processedAt: null,
    })
    return updated
  })
}
