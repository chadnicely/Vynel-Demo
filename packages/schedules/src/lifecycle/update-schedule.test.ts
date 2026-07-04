import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import type { Database } from '@vynel/db'
import { createSchedule } from './create-schedule.js'
import { updateSchedule } from './update-schedule.js'

function seedSchedule(db: Database, channelId = 'channel-1') {
  const now = new Date()
  const user = insertUser(db, {
    id: randomUUID(),
    displayName: 'Dana',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  })
  const workspace = insertWorkspace(db, {
    id: randomUUID(),
    userId: user.id,
    name: 'Bakery',
    kind: 'small-business',
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
  const schedule = createSchedule(db, {
    userId: user.id,
    workspaceId: workspace.id,
    templateKind: 'morning-briefing',
    channelId,
  })
  return { user, workspace, schedule }
}

describe('updateSchedule', () => {
  it('patches displayName without moving nextScheduledFireAt', async () => {
    await withTestDatabase(async (db) => {
      const { user, schedule } = seedSchedule(db)
      const before = schedule.nextScheduledFireAt
      const updated = updateSchedule(db, {
        scheduleId: schedule.id,
        userId: user.id,
        displayName: 'My briefing',
      })
      expect(updated.displayName).toBe('My briefing')
      expect(updated.nextScheduledFireAt?.getTime()).toBe(before?.getTime())
    })
  })

  it('recomputes nextScheduledFireAt when the cron changes', async () => {
    await withTestDatabase(async (db) => {
      const { user, schedule } = seedSchedule(db)
      const updated = updateSchedule(db, {
        scheduleId: schedule.id,
        userId: user.id,
        cronExpression: '0 17 * * FRI',
      })
      expect(updated.cronExpression).toBe('0 17 * * FRI')
      expect(updated.nextScheduledFireAt).not.toBeNull()
      expect(updated.nextScheduledFireAt?.getTime()).not.toBe(schedule.nextScheduledFireAt?.getTime())
    })
  })

  it('rejects an invalid cron change with ValidationError', async () => {
    await withTestDatabase(async (db) => {
      const { user, schedule } = seedSchedule(db)
      expect(() =>
        updateSchedule(db, { scheduleId: schedule.id, userId: user.id, cronExpression: 'bogus' }),
      ).toThrow(/Invalid cron/)
    })
  })

  it('rejects clearing the channel while destination is chat-and-channel', async () => {
    await withTestDatabase(async (db) => {
      const { user, schedule } = seedSchedule(db)
      expect(() =>
        updateSchedule(db, { scheduleId: schedule.id, userId: user.id, channelId: null }),
      ).toThrow(/channel is required/)
    })
  })

  it('throws NotFoundError for a schedule owned by another user (no enumeration)', async () => {
    await withTestDatabase(async (db) => {
      const { schedule } = seedSchedule(db)
      expect(() =>
        updateSchedule(db, {
          scheduleId: schedule.id,
          userId: randomUUID(),
          displayName: 'hijack',
        }),
      ).toThrow(/not found/i)
    })
  })
})
