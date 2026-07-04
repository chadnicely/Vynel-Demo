import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { findScheduleById } from '../repositories/index.js'
import type { Database } from '@vynel/db'
import { createSchedule } from './create-schedule.js'
import { isOneTimeSchedule } from '@vynel/contracts/schedules/one-time'

function seedUserWorkspace(db: Database) {
  const now = new Date()
  const user = insertUser(db, {
    id: randomUUID(),
    displayName: 'Dana',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'America/Los_Angeles',
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
  return { user, workspace }
}

describe('createSchedule', () => {
  it('creates a morning-briefing from the template, defaulting tz + computing next-fire', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedUserWorkspace(db)
      const schedule = createSchedule(db, {
        userId: user.id,
        workspaceId: workspace.id,
        templateKind: 'morning-briefing',
        channelId: 'channel-1',
      })
      expect(schedule.templateKind).toBe('morning-briefing')
      expect(schedule.scheduleKind).toBe('recurring')
      expect(schedule.cronExpression).toBe('0 8 * * *')
      expect(schedule.timezone).toBe('America/Los_Angeles') // defaulted from the user row
      expect(schedule.destinationKind).toBe('chat-and-channel')
      expect(schedule.isEnabled).toBe(true)
      expect(schedule.nextScheduledFireAt).not.toBeNull()
      expect(findScheduleById(db, schedule.id)?.id).toBe(schedule.id)
    })
  })

  it('rejects an invalid cron expression with ValidationError', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedUserWorkspace(db)
      expect(() =>
        createSchedule(db, {
          userId: user.id,
          workspaceId: workspace.id,
          templateKind: 'custom',
          cronExpression: 'not a cron',
        }),
      ).toThrow(/Invalid cron/)
    })
  })

  it('rejects chat-and-channel without a channelId', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedUserWorkspace(db)
      expect(() =>
        createSchedule(db, {
          userId: user.id,
          workspaceId: workspace.id,
          templateKind: 'morning-briefing', // defaults to chat-and-channel
        }),
      ).toThrow(/channel is required/)
    })
  })

  it('rejects an unknown template kind', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedUserWorkspace(db)
      expect(() =>
        createSchedule(db, {
          userId: user.id,
          workspaceId: workspace.id,
          templateKind: 'nope' as never,
        }),
      ).toThrow(/Unknown schedule template/)
    })
  })

  it('creates a one-time schedule (fireAt) with scheduleKind "one-time", null cron + the exact fire time', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedUserWorkspace(db)
      const fireAt = new Date(Date.now() + 15 * 60_000) // "remind me in 15 minutes"
      const schedule = createSchedule(db, {
        userId: user.id,
        workspaceId: workspace.id,
        templateKind: 'custom',
        destinationKind: 'chat-only',
        promptTemplate: 'Remind me about my 2pm meeting.',
        fireAt,
      })
      expect(schedule.scheduleKind).toBe('one-time')
      expect(isOneTimeSchedule(schedule)).toBe(true)
      expect(schedule.cronExpression).toBeNull()
      expect(schedule.nextScheduledFireAt?.getTime()).toBe(fireAt.getTime())
    })
  })

  it('rejects a one-time schedule whose fireAt is in the past', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedUserWorkspace(db)
      expect(() =>
        createSchedule(db, {
          userId: user.id,
          workspaceId: workspace.id,
          templateKind: 'custom',
          fireAt: new Date(Date.now() - 60_000),
        }),
      ).toThrow(/future/)
    })
  })

  it('treats the former "@once" sentinel as just an invalid cron (no longer reserved)', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedUserWorkspace(db)
      expect(() =>
        createSchedule(db, {
          userId: user.id,
          workspaceId: workspace.id,
          templateKind: 'custom',
          destinationKind: 'chat-only',
          cronExpression: '@once',
        }),
      ).toThrow(/Invalid cron/)
    })
  })

  it('creates a GLOBAL one-time reminder (null workspaceId) and persists it with null workspaceId', async () => {
    await withTestDatabase(async (db) => {
      const { user } = seedUserWorkspace(db)
      const schedule = createSchedule(db, {
        userId: user.id,
        workspaceId: null, // GLOBAL scope — no workspace
        templateKind: 'custom',
        destinationKind: 'chat-only',
        promptTemplate: 'Remind me to take a break.',
        fireAt: new Date(Date.now() + 15 * 60_000),
      })
      expect(schedule.workspaceId).toBeNull()
      expect(isOneTimeSchedule(schedule)).toBe(true)
      expect(findScheduleById(db, schedule.id)?.workspaceId).toBeNull()
    })
  })

  it('defaults a one-time schedule to catch-up (overriding the template) so an offline miss is delivered late, not dropped', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seedUserWorkspace(db)
      const schedule = createSchedule(db, {
        userId: user.id,
        workspaceId: workspace.id,
        templateKind: 'custom', // the custom template's own default is catchUpOnMiss:false
        destinationKind: 'chat-only',
        fireAt: new Date(Date.now() + 60_000),
      })
      expect(schedule.catchUpOnMiss).toBe(true)
    })
  })
})
