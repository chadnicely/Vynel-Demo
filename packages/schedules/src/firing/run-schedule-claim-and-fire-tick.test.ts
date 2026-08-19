import { describe, it, expect, vi } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import {
  findScheduleById,
  listScheduleRunsForSchedule,
  updateSchedule,
} from '../repositories/index.js'
import { seedDueSchedule, stubFireDeps } from '../test-support.js'
import { runScheduleClaimAndFireTick } from './run-schedule-claim-and-fire-tick.js'
import { ScheduleFirePool } from './schedule-fire-pool.js'
import type { FireScheduleDeps } from '../schedules-types.js'
import type { Database } from '@vynel/db'
import type { Schedule } from '../repositories/index.js'
import type { ChatSessionResponse } from '@vynel/contracts/chat/chat-http'

// The chat turn is INJECTED via `stubFireDeps` (no module mock — the leaf never
// imports the chat leaf). The stub's `startChatTurn` is a no-op generator and
// its `composeWorkspaceMcpServers` counts builds (`state.buildCount`), which
// stands in for the fire count of the turn-driving branch. Each test owns its
// pool — the poll service's one-per-process instance — and the shared-pool
// tests below pass the SAME pool to overlapping ticks.

const TWO_DAYS_AGO = new Date(Date.now() - 2 * 24 * 60 * 60_000)
const CLEAN = { firedCount: 0, missedCount: 0, failedCount: 0, skippedCount: 0 }

const tick = (db: Database, deps: FireScheduleDeps, pool = new ScheduleFirePool()) =>
  runScheduleClaimAndFireTick(db, deps, pool)

const isClaimed = (db: Database, schedule: Schedule): boolean => {
  const after = findScheduleById(db, schedule.id)!
  return (
    after.nextScheduledFireAt === null ||
    after.nextScheduledFireAt.getTime() !== schedule.nextScheduledFireAt!.getTime()
  )
}

describe('runScheduleClaimAndFireTick', () => {
  it('fires an on-time due slot exactly once (triggerKind poll)', async () => {
    await withTestDatabase(async (db) => {
      const schedule = seedDueSchedule(db) // 30s ago → due, not overdue
      const deps = stubFireDeps()

      const summary = await tick(db, deps)

      expect(summary).toEqual({ ...CLEAN, firedCount: 1 })
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

      // Two pools = two processes racing the same row: the worker's claim is
      // the arbiter, so exactly one fires and the other loses the claim.
      await Promise.all([tick(db, deps), tick(db, deps)])

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

      const summary = await tick(db, deps)

      expect(summary).toEqual({ ...CLEAN, missedCount: 1 })
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

      const summary = await tick(db, deps)

      expect(summary).toEqual({ ...CLEAN, firedCount: 1 })
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
      const pool = new ScheduleFirePool()

      const first = await tick(db, deps, pool)
      expect(first).toEqual({ ...CLEAN, firedCount: 1 })
      // Disarmed: the claim set nextScheduledFireAt to null (computeNextFireAt
      // returns null for a one-time), so it can never be re-listed.
      expect(findScheduleById(db, schedule.id)!.nextScheduledFireAt).toBeNull()

      // A second tick must NOT re-fire it.
      const second = await tick(db, deps, pool)
      expect(second).toEqual(CLEAN)
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
      const pool = new ScheduleFirePool()

      const first = await tick(db, deps, pool)
      expect(first).toEqual({ ...CLEAN, firedCount: 1 })
      const runs = listScheduleRunsForSchedule(db, schedule.id)
      expect(runs).toHaveLength(1)
      expect(runs[0]!.triggerKind).toBe('catchup')
      // Disarmed even on the catch-up path.
      expect(findScheduleById(db, schedule.id)!.nextScheduledFireAt).toBeNull()

      const second = await tick(db, deps, pool)
      expect(second).toEqual(CLEAN)
    })
  })

  it('skips a disabled schedule (not due)', async () => {
    await withTestDatabase(async (db) => {
      const schedule = seedDueSchedule(db, { isEnabled: false })
      const deps = stubFireDeps()
      const summary = await tick(db, deps)
      expect(summary).toEqual(CLEAN)
      expect(listScheduleRunsForSchedule(db, schedule.id)).toHaveLength(0)
    })
  })
})

// ── Background-turns BT3: the due set fires CONCURRENTLY through ONE pool ────
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

const flushMacrotask = () => new Promise((resolve) => setImmediate(resolve))

describe('runScheduleClaimAndFireTick — concurrent, bounded fires (background-turns BT3)', () => {
  it('fires two due schedules concurrently — each claimed by the worker that fires it', async () => {
    await withTestDatabase(async (db) => {
      const first = seedDueSchedule(db)
      const second = seedDueSchedule(db)
      const turns = controllableTurns()
      const deps = { ...stubFireDeps(), startChatTurn: turns.startChatTurn }

      const ticking = tick(db, deps, new ScheduleFirePool(3))
      // Both turns are live at once while NEITHER has completed …
      await turns.waitForStarted(2)
      expect(turns.started.sort()).toEqual([first.workspaceId, second.workspaceId].sort())
      expect(listScheduleRunsForSchedule(db, first.id)[0]!.status).toBe('running')
      expect(listScheduleRunsForSchedule(db, second.id)[0]!.status).toBe('running')
      // … and both slots are claimed (advanced past the due value) — by the
      // workers running them.
      expect(isClaimed(db, first)).toBe(true)
      expect(isClaimed(db, second)).toBe(true)

      turns.releaseAll()
      expect(await ticking).toEqual({ ...CLEAN, firedCount: 2 })
      expect(listScheduleRunsForSchedule(db, first.id)[0]!.status).toBe('completed')
      expect(listScheduleRunsForSchedule(db, second.id)[0]!.status).toBe('completed')
    })
  })

  it('holds the bound: with a pool of 2 the third fire waits for a freed slot — still UNCLAIMED while it waits', async () => {
    await withTestDatabase(async (db) => {
      const schedules = [seedDueSchedule(db), seedDueSchedule(db), seedDueSchedule(db)]
      const turns = controllableTurns()
      const deps = { ...stubFireDeps(), startChatTurn: turns.startChatTurn }

      const ticking = tick(db, deps, new ScheduleFirePool(2))
      await turns.waitForStarted(2)
      await flushMacrotask()
      expect(turns.started).toHaveLength(2)
      // The waiting third is not claimed and has no run row — a kill here
      // would lose nothing (it is still due for the next tick).
      const waiting = schedules.find((schedule) => !turns.started.includes(schedule.workspaceId!))!
      expect(isClaimed(db, waiting)).toBe(false)
      expect(listScheduleRunsForSchedule(db, waiting.id)).toHaveLength(0)

      turns.release(turns.started[0]!)
      await turns.waitForStarted(3)
      expect(turns.started).toHaveLength(3)
      expect(isClaimed(db, waiting)).toBe(true) // claimed by the worker that now fires it

      turns.releaseAll()
      expect(await ticking).toEqual({ ...CLEAN, firedCount: 3 })
      for (const schedule of schedules) {
        expect(listScheduleRunsForSchedule(db, schedule.id)[0]!.status).toBe('completed')
      }
    })
  })

  it('the pool defaults to a bound of 3 when the owner names none', async () => {
    await withTestDatabase(async (db) => {
      for (let i = 0; i < 4; i += 1) seedDueSchedule(db)
      const turns = controllableTurns()
      const deps = { ...stubFireDeps(), startChatTurn: turns.startChatTurn }

      const ticking = tick(db, deps, new ScheduleFirePool())
      await turns.waitForStarted(3)
      await flushMacrotask()
      expect(turns.started).toHaveLength(3)

      turns.releaseAll()
      await turns.waitForStarted(4)
      turns.releaseAll()
      expect(await ticking).toEqual({ ...CLEAN, firedCount: 4 })
    })
  })

  it('a kill mid-batch loses no slot: what was still waiting is unclaimed, so the next tick (a fresh process) fires it', async () => {
    await withTestDatabase(async (db) => {
      const schedules = [seedDueSchedule(db), seedDueSchedule(db)]
      const turns = controllableTurns()
      const deps = { ...stubFireDeps(), startChatTurn: turns.startChatTurn }

      // Bound 1: one fire runs, the other waits for the slot — then the
      // process "dies" (this tick is abandoned mid-flight).
      const abandonedTick = tick(db, deps, new ScheduleFirePool(1))
      await turns.waitForStarted(1)
      const running = schedules.find((schedule) => schedule.workspaceId === turns.started[0])!
      const waiting = schedules.find((schedule) => schedule !== running)!
      expect(isClaimed(db, running)).toBe(true)
      expect(isClaimed(db, waiting)).toBe(false)
      expect(listScheduleRunsForSchedule(db, waiting.id)).toHaveLength(0)

      // The restart: a new pool, the same DB. The waiting slot is still due
      // and fires; the running one is claimed (its row is the evidence) and
      // is not fired twice.
      const restartedTurns = controllableTurns()
      const restarted = tick(
        db,
        { ...deps, startChatTurn: restartedTurns.startChatTurn },
        new ScheduleFirePool(1),
      )
      await restartedTurns.waitForStarted(1)
      expect(restartedTurns.started).toEqual([waiting.workspaceId])
      restartedTurns.releaseAll()
      expect(await restarted).toEqual({ ...CLEAN, firedCount: 1 })
      expect(listScheduleRunsForSchedule(db, waiting.id)[0]!.status).toBe('completed')

      // Had the dead process lived on, its worker would reach the waiting
      // slot, lose the claim to the restart, and fire nothing more.
      turns.releaseAll()
      expect(await abandonedTick).toEqual({ ...CLEAN, firedCount: 1 })
      expect(listScheduleRunsForSchedule(db, waiting.id)).toHaveLength(1)
      expect(listScheduleRunsForSchedule(db, running.id)).toHaveLength(1)
    })
  })

  it('an unexpected throw in one fire never abandons the batch — logged once, counted, the tick resolves', async () => {
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
      const deps = { ...stubFireDeps(), startChatTurn, logger }

      const summary = await tick(db, deps, new ScheduleFirePool(1))

      expect(summary).toEqual({ ...CLEAN, firedCount: 1, failedCount: 1 })
      expect(listScheduleRunsForSchedule(db, first.id)[0]!.status).toBe('completed')
      expect(listScheduleRunsForSchedule(db, second.id)).toHaveLength(0)
      expect(logger.error).toHaveBeenCalledTimes(1)
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ scheduleId: second.id }),
        'schedule fire threw unexpectedly',
      )
    })
  })
})

// ── The bound is per PROCESS: one pool shared by every tick ──────────────────

describe('runScheduleClaimAndFireTick — one pool across ticks', () => {
  it('two overlapping ticks never exceed the bound; the second queues nothing for a schedule already in the pool', async () => {
    await withTestDatabase(async (db) => {
      const schedules = [seedDueSchedule(db), seedDueSchedule(db), seedDueSchedule(db)]
      const turns = controllableTurns()
      const deps = { ...stubFireDeps(), startChatTurn: turns.startChatTurn }
      const pool = new ScheduleFirePool(1)

      const firstTick = tick(db, deps, pool)
      await turns.waitForStarted(1)
      // The next minute's tick arrives while the first still holds the pool:
      // it re-lists the two waiting (unclaimed) schedules, finds them already
      // queued, and queues nothing — no second pool, no stacking.
      const secondTick = await tick(db, deps, pool)
      expect(secondTick).toEqual({ ...CLEAN, skippedCount: 2 })
      expect(pool.activeFireCount).toBe(1)
      expect(turns.started).toHaveLength(1)

      // Everything still fires exactly once, one at a time, through the first tick.
      for (let fired = 1; fired <= 3; fired += 1) {
        await turns.waitForStarted(fired)
        expect(pool.activeFireCount).toBe(1)
        turns.release(turns.started[fired - 1]!)
      }
      expect(await firstTick).toEqual({ ...CLEAN, firedCount: 3 })
      for (const schedule of schedules) {
        expect(listScheduleRunsForSchedule(db, schedule.id)).toHaveLength(1)
      }
      expect(pool.activeFireCount).toBe(0)
    })
  })

  it('a schedule due again while its previous fire still runs waits for it (one fire per schedule at a time)', async () => {
    await withTestDatabase(async (db) => {
      const schedule = seedDueSchedule(db, { cronExpression: '* * * * *' })
      const turns = controllableTurns()
      const deps = { ...stubFireDeps(), startChatTurn: turns.startChatTurn }
      const pool = new ScheduleFirePool(3)

      const firstTick = tick(db, deps, pool)
      await turns.waitForStarted(1)
      expect(pool.holds(schedule.id)).toBe(true)

      // The next slot comes due while the fire still runs (an every-minute
      // schedule with a slow turn) — its fire is still in the pool, so this
      // tick leaves it for later instead of queuing a second fire of the same
      // schedule to park behind the first.
      updateSchedule(db, schedule.id, { nextScheduledFireAt: new Date(Date.now() - 1_000) })
      expect(await tick(db, deps, pool)).toEqual({ ...CLEAN, skippedCount: 1 })
      expect(turns.started).toHaveLength(1)

      turns.releaseAll()
      expect(await firstTick).toEqual({ ...CLEAN, firedCount: 1 })
      expect(pool.holds(schedule.id)).toBe(false)
      expect(listScheduleRunsForSchedule(db, schedule.id)).toHaveLength(1)

      // Once the fire is done, the still-due slot fires on the next tick.
      const nextTick = tick(db, deps, pool)
      await turns.waitForStarted(2)
      turns.releaseAll()
      expect(await nextTick).toEqual({ ...CLEAN, firedCount: 1 })
      expect(listScheduleRunsForSchedule(db, schedule.id)).toHaveLength(2)
    })
  })
})
