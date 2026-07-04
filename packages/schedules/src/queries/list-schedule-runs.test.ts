import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { insertScheduleRun } from '../repositories/index.js'
import type { Database } from '@vynel/db'
import { createSchedule } from '../lifecycle/create-schedule.js'
import { listScheduleRuns } from './list-schedule-runs.js'

function seedSchedule(db: Database) {
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
    templateKind: 'custom',
  })
  return { user, schedule }
}

describe('listScheduleRuns', () => {
  it('returns the run history newest-first for the owner', async () => {
    await withTestDatabase(async (db) => {
      const { user, schedule } = seedSchedule(db)
      const base = new Date('2026-06-05T00:00:00Z').getTime()
      for (let minute = 0; minute < 3; minute++) {
        insertScheduleRun(db, {
          id: randomUUID(),
          scheduleId: schedule.id,
          scheduledFireAt: new Date(base + minute * 60_000),
          startedAt: new Date(base + minute * 60_000),
          completedAt: null,
          chatSessionId: null,
          status: 'completed',
          statusMessage: null,
          triggerKind: 'poll',
        })
      }
      const runs = listScheduleRuns(db, { scheduleId: schedule.id, userId: user.id })
      expect(runs).toHaveLength(3)
      expect(runs[0]!.startedAt.getTime()).toBeGreaterThan(runs[2]!.startedAt.getTime())
    })
  })

  it('throws NotFoundError when the schedule is not owned by the caller', async () => {
    await withTestDatabase(async (db) => {
      const { schedule } = seedSchedule(db)
      expect(() =>
        listScheduleRuns(db, { scheduleId: schedule.id, userId: randomUUID() }),
      ).toThrow(/not found/i)
    })
  })
})
