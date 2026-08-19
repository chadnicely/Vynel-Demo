import { describe, it, expect, vi } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import {
  findScheduleById,
  listScheduleRunsForSchedule,
  updateSchedule,
} from '../repositories/index.js'
import { seedDueSchedule, stubFireDeps } from '../test-support.js'
import { runScheduleClaimAndFireTick } from './run-schedule-claim-and-fire-tick.js'
import type { FireScheduleDeps } from '../schedules-types.js'
import type { ChatSessionResponse } from '@vynel/contracts/chat/chat-http'

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

// ── Background-turns BT3: the claimed batch fires CONCURRENTLY, bounded ──────
//
// The fires are driven by a controllable `startChatTurn` stub: each fired
// turn announces that it started, then parks until the test releases it (or
// until a shared barrier opens), then completes normally. Everything is
// event-driven — no sleeps — so a regression to serial firing shows up as a
// clear "never started" failure, not a flake.

function controllableTurns() {
  const started: string[] = []
  const releases = new Map<string, () => void>()
  const startedListeners: Array<() => void> = []
  const notifyStarted = (): void => startedListeners.splice(0).forEach((listener) => listener())
  const startChatTurn: FireScheduleDeps['startChatTurn'] = async function* (_db, input) {
    started.push(input.workspaceId)
    notifyStarted()
    await new Promise<void>((resolve) => releases.set(input.workspaceId, resolve))
    yield {
      kind: 'session-created',
      session: { id: `sess-${input.workspaceId}` } as unknown as ChatSessionResponse,
    }
    yield { kind: 'session-completed', sessionId: `sess-${input.workspaceId}` }
  }
  /** Resolves once at least `count` turns have started (immediately if they
   *  already have); rejects after `timeoutMs` with a message naming the gap. */
  const waitForStarted = (count: number, timeoutMs = 3_000): Promise<void> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`only ${started.length} of ${count} fires started — serial tick?`)),
        timeoutMs,
      )
      const check = (): void => {
        if (started.length >= count) {
          clearTimeout(timer)
          resolve()
        } else {
          startedListeners.push(check)
        }
      }
      check()
    })
  const release = (workspaceId: string): void => {
    releases.get(workspaceId)?.()
    releases.delete(workspaceId)
  }
  return { startChatTurn, started, waitForStarted, release, releaseAll: () => [...releases.keys()].forEach(release) }
}

describe('runScheduleClaimAndFireTick — concurrent, bounded fires (background-turns BT3)', () => {
  it('fires two due schedules concurrently — both claimed before either completes', async () => {
    await withTestDatabase(async (db) => {
      const first = seedDueSchedule(db)
      const second = seedDueSchedule(db)
      const turns = controllableTurns()
      const deps = { ...stubFireDeps(), startChatTurn: turns.startChatTurn, maxConcurrentFires: 3 }

      const tick = runScheduleClaimAndFireTick(db, deps)
      // Both turns are live at once while NEITHER has completed …
      await turns.waitForStarted(2)
      expect(turns.started.sort()).toEqual([first.workspaceId, second.workspaceId].sort())
      expect(listScheduleRunsForSchedule(db, first.id)[0]!.status).toBe('running')
      expect(listScheduleRunsForSchedule(db, second.id)[0]!.status).toBe('running')
      // … and both slots were already claimed (advanced past the due value).
      expect(findScheduleById(db, first.id)!.nextScheduledFireAt!.getTime()).toBeGreaterThan(
        first.nextScheduledFireAt!.getTime(),
      )
      expect(findScheduleById(db, second.id)!.nextScheduledFireAt!.getTime()).toBeGreaterThan(
        second.nextScheduledFireAt!.getTime(),
      )

      turns.releaseAll()
      expect(await tick).toEqual({ firedCount: 2, missedCount: 0 })
      expect(listScheduleRunsForSchedule(db, first.id)[0]!.status).toBe('completed')
      expect(listScheduleRunsForSchedule(db, second.id)[0]!.status).toBe('completed')
    })
  })

  it('holds the bound: with maxConcurrentFires 2 the third fire waits for a freed slot', async () => {
    await withTestDatabase(async (db) => {
      const schedules = [seedDueSchedule(db), seedDueSchedule(db), seedDueSchedule(db)]
      const turns = controllableTurns()
      const deps = { ...stubFireDeps(), startChatTurn: turns.startChatTurn, maxConcurrentFires: 2 }

      const tick = runScheduleClaimAndFireTick(db, deps)
      await turns.waitForStarted(2)
      // The third is claimed (its run row exists, pending/running is the
      // executor's business) but has NOT started its turn — the slot is taken.
      await new Promise((resolve) => setImmediate(resolve))
      expect(turns.started).toHaveLength(2)

      turns.release(turns.started[0]!)
      await turns.waitForStarted(3)
      expect(turns.started).toHaveLength(3)

      turns.releaseAll()
      expect(await tick).toEqual({ firedCount: 3, missedCount: 0 })
      for (const schedule of schedules) {
        expect(listScheduleRunsForSchedule(db, schedule.id)[0]!.status).toBe('completed')
      }
    })
  })

  it('defaults to a bound of 3 when the binder names none', async () => {
    await withTestDatabase(async (db) => {
      for (let i = 0; i < 4; i += 1) seedDueSchedule(db)
      const turns = controllableTurns()
      const deps = { ...stubFireDeps(), startChatTurn: turns.startChatTurn }

      const tick = runScheduleClaimAndFireTick(db, deps)
      await turns.waitForStarted(3)
      await new Promise((resolve) => setImmediate(resolve))
      expect(turns.started).toHaveLength(3)

      turns.releaseAll()
      await turns.waitForStarted(4)
      turns.releaseAll()
      expect(await tick).toEqual({ firedCount: 4, missedCount: 0 })
    })
  })

  it('an unexpected throw in one fire never abandons the batch — the rest run, then the tick rethrows once', async () => {
    await withTestDatabase(async (db) => {
      const first = seedDueSchedule(db)
      const second = seedDueSchedule(db)
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
      // The first fire disables the second schedule mid-turn — `fireSchedule`
      // then refuses it ("not found or disabled") BEFORE any run row exists:
      // the one unexpected-throw shape the serial tick used to abort on.
      const startChatTurn: FireScheduleDeps['startChatTurn'] = async function* (turnDb, input) {
        if (input.workspaceId === first.workspaceId) {
          updateSchedule(turnDb, second.id, { isEnabled: false })
        }
        yield {
          kind: 'session-created',
          session: { id: `sess-${input.workspaceId}` } as unknown as ChatSessionResponse,
        }
      }
      const deps = { ...stubFireDeps(), startChatTurn, logger, maxConcurrentFires: 1 }

      await expect(runScheduleClaimAndFireTick(db, deps)).rejects.toThrow(/1 fire\(s\) threw/)

      expect(listScheduleRunsForSchedule(db, first.id)[0]!.status).toBe('completed')
      expect(listScheduleRunsForSchedule(db, second.id)).toHaveLength(0)
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ scheduleId: second.id }),
        'schedule fire threw unexpectedly',
      )
    })
  })
})
