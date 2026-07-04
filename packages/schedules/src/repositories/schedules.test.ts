// Repository tests for the `schedules` table. Uses the LOCAL test-support
// helper to avoid the `packages/db ↔ packages/testing` workspace cycle.
// Spec: `docs/blueprints/schedules/blueprint.md §4` + coding §8.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  listDueSchedules,
  listSchedulesForWorkspace,
  listSchedulesForUser,
  claimDueSchedule,
  findScheduleById,
  insertSchedule,
  updateSchedule,
  hardDeleteSchedule,
  type NewSchedule,
} from './schedules.js'
import { insertScheduleRun, listScheduleRunsForSchedule } from './schedule-runs.js'

function makeUser(id: string = randomUUID()) {
  const now = new Date()
  return {
    id,
    displayName: 'Test User',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  }
}

function makeWorkspace(userId: string) {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    name: 'Acme',
    kind: 'small-business' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }
}

function makeSchedule(
  userId: string,
  workspaceId: string,
  overrides: Partial<NewSchedule> = {},
): NewSchedule {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    workspaceId,
    templateKind: 'morning-briefing',
    scheduleKind: 'recurring',
    displayName: 'Morning briefing',
    cronExpression: '0 8 * * *',
    timezone: 'UTC',
    promptTemplate: 'Good morning',
    destinationKind: 'chat-only',
    channelId: null,
    catchUpOnMiss: false,
    isEnabled: true,
    approvalTimeoutMsOverride: null,
    lastFiredAt: null,
    nextScheduledFireAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('schedules repository', () => {
  it('insertSchedule inserts and findScheduleById returns it', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const inserted = insertSchedule(db, makeSchedule(user.id, workspace.id))
      const found = findScheduleById(db, inserted.id)
      expect(found?.id).toBe(inserted.id)
      expect(found?.templateKind).toBe('morning-briefing')
    })
  })

  it('findScheduleById returns null when absent', async () => {
    await withTestDatabase(async (db) => {
      expect(findScheduleById(db, randomUUID())).toBeNull()
    })
  })

  it('updateSchedule patches and returns the row; throws on missing', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const schedule = insertSchedule(db, makeSchedule(user.id, workspace.id))
      const updated = updateSchedule(db, schedule.id, { isEnabled: false, updatedAt: new Date() })
      expect(updated.isEnabled).toBe(false)
      expect(() => updateSchedule(db, randomUUID(), { isEnabled: false })).toThrow()
    })
  })

  it('hardDeleteSchedule removes the schedule and cascades to schedule_runs', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const schedule = insertSchedule(db, makeSchedule(user.id, workspace.id))
      insertScheduleRun(db, {
        id: randomUUID(),
        scheduleId: schedule.id,
        scheduledFireAt: new Date(),
        startedAt: new Date(),
        completedAt: null,
        chatSessionId: null,
        status: 'completed',
        statusMessage: null,
        triggerKind: 'poll',
      })
      hardDeleteSchedule(db, schedule.id)
      expect(findScheduleById(db, schedule.id)).toBeNull()
      expect(listScheduleRunsForSchedule(db, schedule.id)).toHaveLength(0)
    })
  })

  it('listSchedulesForWorkspace is scoped to userId + workspaceId', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspaceA = insertWorkspace(db, makeWorkspace(user.id))
      const workspaceB = insertWorkspace(db, makeWorkspace(user.id))
      insertSchedule(db, makeSchedule(user.id, workspaceA.id))
      insertSchedule(db, makeSchedule(user.id, workspaceA.id))
      insertSchedule(db, makeSchedule(user.id, workspaceB.id))
      expect(
        listSchedulesForWorkspace(db, { userId: user.id, workspaceId: workspaceA.id }),
      ).toHaveLength(2)
      expect(
        listSchedulesForWorkspace(db, { userId: user.id, workspaceId: workspaceB.id }),
      ).toHaveLength(1)
    })
  })

  it('listSchedulesForUser returns ALL a user’s schedules (workspace + global), scoped to userId', async () => {
    await withTestDatabase(async (db) => {
      const userA = insertUser(db, makeUser())
      const userB = insertUser(db, makeUser())
      const workspaceA = insertWorkspace(db, makeWorkspace(userA.id))
      insertSchedule(db, makeSchedule(userA.id, workspaceA.id)) // workspace-scoped
      insertSchedule(db, makeSchedule(userA.id, workspaceA.id, { workspaceId: null })) // global
      insertSchedule(db, makeSchedule(userB.id, workspaceA.id)) // another user's — must be excluded
      // Both of userA's scopes come back; userB's does not (tenant isolation).
      expect(listSchedulesForUser(db, { userId: userA.id })).toHaveLength(2)
      expect(listSchedulesForUser(db, { userId: userB.id })).toHaveLength(1)
      expect(listSchedulesForUser(db, { userId: randomUUID() })).toHaveLength(0)
    })
  })

  it('listDueSchedules returns only isEnabled rows with nextScheduledFireAt <= now', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const now = new Date('2026-06-05T09:00:00Z')
      const past = new Date('2026-06-05T08:00:00Z')
      const future = new Date('2026-06-05T10:00:00Z')
      const due = insertSchedule(
        db,
        makeSchedule(user.id, workspace.id, { nextScheduledFireAt: past, isEnabled: true }),
      )
      insertSchedule(
        db,
        makeSchedule(user.id, workspace.id, { nextScheduledFireAt: future, isEnabled: true }),
      ) // not yet due
      insertSchedule(
        db,
        makeSchedule(user.id, workspace.id, { nextScheduledFireAt: past, isEnabled: false }),
      ) // disabled
      insertSchedule(
        db,
        makeSchedule(user.id, workspace.id, { nextScheduledFireAt: null, isEnabled: true }),
      ) // never scheduled
      expect(listDueSchedules(db, { now }).map((s) => s.id)).toEqual([due.id])
    })
  })

  it('claimDueSchedule wins once; a stale-value re-claim loses (no double-fire)', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const observed = new Date('2026-06-05T08:00:00Z')
      const next = new Date('2026-06-06T08:00:00Z')
      const schedule = insertSchedule(
        db,
        makeSchedule(user.id, workspace.id, { nextScheduledFireAt: observed }),
      )
      const first = claimDueSchedule(db, {
        id: schedule.id,
        observedNextFireAt: observed,
        nextFireAt: next,
      })
      const second = claimDueSchedule(db, {
        id: schedule.id,
        observedNextFireAt: observed,
        nextFireAt: next,
      })
      expect(first).toBe(true)
      expect(second).toBe(false) // the row no longer equals `observed`
      expect(findScheduleById(db, schedule.id)?.nextScheduledFireAt?.getTime()).toBe(next.getTime())
    })
  })

  it('claimDueSchedule can advance to null (an invalid cron stops the schedule)', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const observed = new Date('2026-06-05T08:00:00Z')
      const schedule = insertSchedule(
        db,
        makeSchedule(user.id, workspace.id, { nextScheduledFireAt: observed }),
      )
      expect(
        claimDueSchedule(db, { id: schedule.id, observedNextFireAt: observed, nextFireAt: null }),
      ).toBe(true)
      expect(findScheduleById(db, schedule.id)?.nextScheduledFireAt).toBeNull()
    })
  })
})
