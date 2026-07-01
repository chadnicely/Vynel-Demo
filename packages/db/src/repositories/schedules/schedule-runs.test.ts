// Repository tests for the `schedule_runs` table. Uses the LOCAL test-support
// helper to avoid the `packages/db ↔ packages/testing` workspace cycle.
// Spec: `docs/blueprints/schedules/blueprint.md §4` + coding §8.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '../../test-support/with-test-database.js'
import { insertUser } from '../users/users.js'
import { insertWorkspace } from '../workspaces/workspaces.js'
import { insertSchedule, type NewSchedule } from './schedules.js'
import {
  insertScheduleRun,
  updateScheduleRun,
  getScheduleRunByIdOrThrow,
  listScheduleRunsForSchedule,
  type NewScheduleRun,
} from './schedule-runs.js'

function seedSchedule(db: Parameters<Parameters<typeof withTestDatabase>[0]>[0]): string {
  const now = new Date()
  const user = insertUser(db, {
    id: randomUUID(),
    displayName: 'Test User',
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
    name: 'Acme',
    kind: 'small-business',
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
  const schedule: NewSchedule = {
    id: randomUUID(),
    userId: user.id,
    workspaceId: workspace.id,
    templateKind: 'custom',
    displayName: 'Custom',
    cronExpression: '0 9 * * *',
    timezone: 'UTC',
    promptTemplate: 'Do the thing',
    destinationKind: 'chat-only',
    channelId: null,
    catchUpOnMiss: false,
    isEnabled: true,
    approvalTimeoutMsOverride: null,
    lastFiredAt: null,
    nextScheduledFireAt: null,
    createdAt: now,
    updatedAt: now,
  }
  return insertSchedule(db, schedule).id
}

function makeRun(scheduleId: string, overrides: Partial<NewScheduleRun> = {}): NewScheduleRun {
  const now = new Date()
  return {
    id: randomUUID(),
    scheduleId,
    scheduledFireAt: now,
    startedAt: now,
    completedAt: null,
    chatSessionId: null,
    status: 'completed',
    statusMessage: null,
    triggerKind: 'poll',
    ...overrides,
  }
}

describe('schedule_runs repository', () => {
  it('insertScheduleRun + getScheduleRunByIdOrThrow round-trip; throws when absent', async () => {
    await withTestDatabase(async (db) => {
      const scheduleId = seedSchedule(db)
      const run = insertScheduleRun(db, makeRun(scheduleId, { status: 'pending' }))
      expect(getScheduleRunByIdOrThrow(db, run.id).status).toBe('pending')
      expect(() => getScheduleRunByIdOrThrow(db, randomUUID())).toThrow()
    })
  })

  it('updateScheduleRun patches status / chatSessionId / completedAt', async () => {
    await withTestDatabase(async (db) => {
      const scheduleId = seedSchedule(db)
      const run = insertScheduleRun(db, makeRun(scheduleId, { status: 'pending' }))
      const completedAt = new Date('2026-06-05T09:01:00Z')
      const updated = updateScheduleRun(db, run.id, {
        status: 'completed',
        chatSessionId: 'session-123',
        completedAt,
      })
      expect(updated.status).toBe('completed')
      expect(updated.chatSessionId).toBe('session-123')
      expect(updated.completedAt?.getTime()).toBe(completedAt.getTime())
    })
  })

  it('listScheduleRunsForSchedule keyset-paginates newest-first on (startedAt DESC, id DESC)', async () => {
    await withTestDatabase(async (db) => {
      const scheduleId = seedSchedule(db)
      // Five runs at strictly increasing startedAt.
      const base = new Date('2026-06-05T00:00:00Z').getTime()
      for (let minute = 0; minute < 5; minute++) {
        insertScheduleRun(db, makeRun(scheduleId, { startedAt: new Date(base + minute * 60_000) }))
      }

      const firstPage = listScheduleRunsForSchedule(db, scheduleId, { limit: 2 })
      expect(firstPage).toHaveLength(2)
      // Newest first.
      expect(firstPage[0]!.startedAt.getTime()).toBeGreaterThan(firstPage[1]!.startedAt.getTime())

      const cursor = { startedAt: firstPage[1]!.startedAt, id: firstPage[1]!.id }
      const secondPage = listScheduleRunsForSchedule(db, scheduleId, { limit: 2, cursor })
      expect(secondPage).toHaveLength(2)
      // No overlap with the first page; strictly older than the cursor.
      expect(secondPage[0]!.startedAt.getTime()).toBeLessThan(cursor.startedAt.getTime())
      const firstPageIds = new Set(firstPage.map((r) => r.id))
      expect(secondPage.every((r) => !firstPageIds.has(r.id))).toBe(true)
    })
  })
})
