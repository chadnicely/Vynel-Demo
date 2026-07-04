import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import {
  findScheduleById,
  listScheduleRunsForSchedule,
} from '../repositories/index.js'
import { seedDueSchedule, stubFireDeps } from '../test-support.js'
import { runScheduleClaimAndFireTick } from './run-schedule-claim-and-fire-tick.js'

// The chat turn is INJECTED via `stubFireDeps` (no module mock — the leaf never
// imports the chat leaf). The stub's `startChatTurn` is a no-op generator and
// its `composeWorkspaceMcpServers` counts builds (`state.buildCount`), which
// stands in for the fire count of the turn-driving branch.

const TWO_DAYS_AGO = new Date(Date.now() - 2 * 24 * 60 * 60_000)

describe('runScheduleClaimAndFireTick', () => {
  it('fires an on-time due slot exactly once (triggerKind poll)', async () => {
    await withTestDatabase(async (db) => {
      const schedule = seedDueSchedule(db) // 30s ago → due, not overdue
      const deps = stubFireDeps()

      const summary = await runScheduleClaimAndFireTick(db, deps)

      expect(summary).toEqual({ firedCount: 1, missedCount: 0 })
      const runs = listScheduleRunsForSchedule(db, schedule.id)
      expect(runs).toHaveLength(1)
      expect(runs[0]!.status).toBe('completed')
      expect(runs[0]!.triggerKind).toBe('poll')
    })
  })

  it('fires a due slot only once under two concurrent ticks (the claim guards)', async () => {
    await withTestDatabase(async (db) => {
      const schedule = seedDueSchedule(db)
      const deps = stubFireDeps()

      await Promise.all([
        runScheduleClaimAndFireTick(db, deps),
        runScheduleClaimAndFireTick(db, deps),
      ])

      expect(deps.state.buildCount).toBe(1) // claim-before-fire → exactly one fire
      expect(listScheduleRunsForSchedule(db, schedule.id)).toHaveLength(1)
    })
  })

  it('records one missed run for an overdue slot when catchUpOnMiss is false, then advances', async () => {
    await withTestDatabase(async (db) => {
      const schedule = seedDueSchedule(db, {
        nextScheduledFireAt: TWO_DAYS_AGO,
        catchUpOnMiss: false,
      })
      const deps = stubFireDeps()

      const summary = await runScheduleClaimAndFireTick(db, deps)

      expect(summary).toEqual({ firedCount: 0, missedCount: 1 })
      expect(deps.state.buildCount).toBe(0) // no turn ran
      const runs = listScheduleRunsForSchedule(db, schedule.id)
      expect(runs).toHaveLength(1)
      expect(runs[0]!.status).toBe('missed')
      // The claim advanced nextScheduledFireAt past the overdue window.
      const after = findScheduleById(db, schedule.id)
      expect(after!.nextScheduledFireAt!.getTime()).toBeGreaterThan(TWO_DAYS_AGO.getTime())
    })
  })

  it('catches up an overdue slot exactly once when catchUpOnMiss is true (triggerKind catchup)', async () => {
    await withTestDatabase(async (db) => {
      const schedule = seedDueSchedule(db, {
        nextScheduledFireAt: TWO_DAYS_AGO,
        catchUpOnMiss: true,
      })
      const deps = stubFireDeps()

      const summary = await runScheduleClaimAndFireTick(db, deps)

      expect(summary).toEqual({ firedCount: 1, missedCount: 0 })
      const runs = listScheduleRunsForSchedule(db, schedule.id)
      expect(runs).toHaveLength(1)
      expect(runs[0]!.status).toBe('completed')
      expect(runs[0]!.triggerKind).toBe('catchup')
    })
  })

  it('fires a one-time schedule once, then disarms it (no re-fire)', async () => {
    await withTestDatabase(async (db) => {
      // A due one-time schedule: the `one-time` kind + a null cron + a fire time
      // 30s in the past.
      const schedule = seedDueSchedule(db, {
        scheduleKind: 'one-time',
        cronExpression: null,
        destinationKind: 'chat-only',
      })
      const deps = stubFireDeps()

      const first = await runScheduleClaimAndFireTick(db, deps)
      expect(first).toEqual({ firedCount: 1, missedCount: 0 })
      // Disarmed: the claim set nextScheduledFireAt to null (computeNextFireAt
      // returns null for a one-time), so it can never be re-listed.
      expect(findScheduleById(db, schedule.id)!.nextScheduledFireAt).toBeNull()

      // A second tick must NOT re-fire it.
      const second = await runScheduleClaimAndFireTick(db, deps)
      expect(second).toEqual({ firedCount: 0, missedCount: 0 })
      expect(deps.state.buildCount).toBe(1) // exactly one fire across both ticks
    })
  })

  it('catches up an offline one-time exactly once (catchup), then disarms', async () => {
    await withTestDatabase(async (db) => {
      const schedule = seedDueSchedule(db, {
        scheduleKind: 'one-time',
        cronExpression: null,
        destinationKind: 'chat-only',
        nextScheduledFireAt: TWO_DAYS_AGO, // Vynel was offline well past the fire time
        catchUpOnMiss: true,
      })
      const deps = stubFireDeps()

      const first = await runScheduleClaimAndFireTick(db, deps)
      expect(first).toEqual({ firedCount: 1, missedCount: 0 })
      const runs = listScheduleRunsForSchedule(db, schedule.id)
      expect(runs).toHaveLength(1)
      expect(runs[0]!.triggerKind).toBe('catchup')
      // Disarmed even on the catch-up path.
      expect(findScheduleById(db, schedule.id)!.nextScheduledFireAt).toBeNull()

      const second = await runScheduleClaimAndFireTick(db, deps)
      expect(second).toEqual({ firedCount: 0, missedCount: 0 })
    })
  })

  it('skips a disabled schedule (not due)', async () => {
    await withTestDatabase(async (db) => {
      const schedule = seedDueSchedule(db, { isEnabled: false })
      const deps = stubFireDeps()
      const summary = await runScheduleClaimAndFireTick(db, deps)
      expect(summary).toEqual({ firedCount: 0, missedCount: 0 })
      expect(listScheduleRunsForSchedule(db, schedule.id)).toHaveLength(0)
    })
  })
})
