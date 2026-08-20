import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { insertSchedule, type NewSchedule } from '../repositories/index.js'
import type { Database } from '@vynel/db'
import { manualFireSchedule } from './manual-fire-schedule.js'
import { ScheduleFirePool } from './schedule-fire-pool.js'
import { stubFireDeps } from '../test-support.js'

function seed(db: Database, overrides: Partial<NewSchedule> = {}) {
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
    name: 'Acme',
    kind: 'small-business',
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
  const schedule = insertSchedule(db, {
    id: randomUUID(),
    userId: user.id,
    workspaceId: workspace.id,
    templateKind: 'custom',
    scheduleKind: 'recurring',
    displayName: 'Custom',
    cronExpression: '0 9 * * *',
    timezone: 'UTC',
    promptTemplate: 'go',
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
  })
  return { user, schedule }
}

describe('manualFireSchedule (guard paths — never reach fireSchedule)', () => {
  it('throws NotFoundError for a schedule owned by another user (no enumeration)', async () => {
    await withTestDatabase(async (db) => {
      const { schedule } = seed(db)
      await expect(
        manualFireSchedule(
          db,
          { scheduleId: schedule.id, userId: randomUUID() },
          stubFireDeps(),
          new ScheduleFirePool(),
        ),
      ).rejects.toThrow(/not found/i)
    })
  })

  it('throws ConflictError for a paused (disabled) schedule (Gate-3 C1)', async () => {
    await withTestDatabase(async (db) => {
      const { user, schedule } = seed(db, { isEnabled: false })
      const deps = stubFireDeps()
      const pool = new ScheduleFirePool()
      await expect(
        manualFireSchedule(db, { scheduleId: schedule.id, userId: user.id }, deps, pool),
      ).rejects.toThrow(/paused/i)
      // The plain-Error guard in fireSchedule is never reached — no MCP build.
      expect(deps.state.builtMcpServer).toBe(false)
      // A guard that answered early must not have taken a slot for a fire that
      // cannot happen — the schedule is still admittable.
      expect(pool.holds(schedule.id)).toBe(false)
    })
  })

  it('declines a fire the shared pool already holds (409) instead of firing twice', async () => {
    await withTestDatabase(async (db) => {
      const { user, schedule } = seed(db)
      const pool = new ScheduleFirePool()
      // The poll tick (or a first click) is mid-fire on this schedule.
      let releaseFirstFire: () => void = () => {}
      const firstFire = pool.admit(
        schedule.id,
        () => new Promise<void>((resolve) => (releaseFirstFire = resolve)),
      )
      const deps = stubFireDeps()
      await expect(
        manualFireSchedule(db, { scheduleId: schedule.id, userId: user.id }, deps, pool),
      ).rejects.toThrow(/already running/i)
      // Declined BEFORE any turn machinery — no second live fire.
      expect(deps.state.builtMcpServer).toBe(false)
      releaseFirstFire()
      await firstFire
      // Once the holder is done the same schedule is admittable again.
      expect(pool.holds(schedule.id)).toBe(false)
    })
  })
})
