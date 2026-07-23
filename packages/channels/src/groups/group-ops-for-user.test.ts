// Integration tests for the user-scoped group ops (list / set-status /
// set-policy). Real SQLite via `withTestDatabase` (no mocking).

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { NotFoundError } from '@vynel/errors'
import { insertUser } from '@vynel/db/repositories/users'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import {
  insertChannelChatGroup,
  findChannelChatGroupById,
  type Channel,
} from '../repositories/index.js'
import { makeUser, seedChannel } from '../test-support.js'
import { listGroupsForUser } from './list-groups-for-user.js'
import { setGroupStatusForUser } from './set-group-status-for-user.js'
import { setGroupPolicyForUser } from './set-group-policy-for-user.js'
import {
  CHANNEL_GROUP_STATUS_CHANGED,
  CHANNEL_GROUP_POLICY_CHANGED,
} from '../channels-events.js'
import type { Database } from '@vynel/db'

function seedGroup(db: Database, channel: Channel) {
  return insertChannelChatGroup(db, {
    id: randomUUID(),
    channelId: channel.id,
    externalChatContextId: '-100777',
    title: 'Marketing Team',
    status: 'pending',
    memberPolicy: 'everyone',
    firstSeenAt: new Date(),
    lastInboundAt: null,
    approvedAt: null,
  })
}

describe('group ops (user-scoped)', () => {
  it('lists a channel’s groups; approving stamps approvedAt and co-commits the event', async () => {
    await withTestDatabase(async (db) => {
      const { user, channel } = seedChannel(db, { workspaceId: null })
      const group = seedGroup(db, channel)

      expect(listGroupsForUser(db, { channelId: channel.id, userId: user.id })).toHaveLength(1)

      const approved = setGroupStatusForUser(db, {
        channelId: channel.id,
        userId: user.id,
        groupId: group.id,
        status: 'approved',
      })
      expect(approved.status).toBe('approved')
      expect(approved.approvedAt).not.toBeNull()

      const events = listOutboxEventsByType(db, CHANNEL_GROUP_STATUS_CHANGED)
      expect(events).toHaveLength(1)
      expect(events[0]!.payload).toMatchObject({
        channelId: channel.id,
        userId: user.id,
        groupId: group.id,
        status: 'approved',
      })
      expect(JSON.stringify(events[0]!.payload)).not.toContain('secret-token')
    })
  })

  it('flips memberPolicy and co-commits the policy event', async () => {
    await withTestDatabase(async (db) => {
      const { user, channel } = seedChannel(db, { workspaceId: null })
      const group = seedGroup(db, channel)

      const updated = setGroupPolicyForUser(db, {
        channelId: channel.id,
        userId: user.id,
        groupId: group.id,
        memberPolicy: 'allowlist',
      })
      expect(updated.memberPolicy).toBe('allowlist')
      expect(listOutboxEventsByType(db, CHANNEL_GROUP_POLICY_CHANGED)).toHaveLength(1)
    })
  })

  it('rejects another user’s channel AND a cross-channel group id identically (404, nothing written)', async () => {
    await withTestDatabase(async (db) => {
      const { user, channel } = seedChannel(db)
      const group = seedGroup(db, channel)
      const attacker = insertUser(db, makeUser())

      // Attacker on the victim's channel: the channel guard throws first.
      expect(() =>
        setGroupStatusForUser(db, {
          channelId: channel.id,
          userId: attacker.id,
          groupId: group.id,
          status: 'approved',
        }),
      ).toThrow(NotFoundError)

      // The owner with a group id from ANOTHER channel: same 404.
      const { channel: otherChannel } = seedChannel(db)
      const foreignGroup = seedGroup(db, otherChannel)
      expect(() =>
        setGroupPolicyForUser(db, {
          channelId: channel.id,
          userId: user.id,
          groupId: foreignGroup.id,
          memberPolicy: 'allowlist',
        }),
      ).toThrow(NotFoundError)

      expect(findChannelChatGroupById(db, group.id)?.status).toBe('pending')
      expect(listOutboxEventsByType(db, CHANNEL_GROUP_STATUS_CHANGED)).toHaveLength(0)
      expect(listOutboxEventsByType(db, CHANNEL_GROUP_POLICY_CHANGED)).toHaveLength(0)
    })
  })
})
