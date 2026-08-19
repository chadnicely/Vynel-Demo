// The per-minute poll body. Lists the due schedules, hands each to the shared
// `ScheduleFirePool`, and — inside the worker, right before the fire — claims
// its slot with an atomic compare-and-swap on `nextScheduledFireAt`, so
// overlapping ticks can never double-fire the same slot. The claim is the ONLY
// place nextScheduledFireAt advances — to the next croner slot, past the whole
// overdue window in one step. Catch-up folds in here: an overdue slot fires
// once for the observed slot (if catchUpOnMiss) or records a single 'missed'
// run; never both, never a flood. async (each fire drives the provider
// stream).
//
// Background-turns BT3: the due set fires CONCURRENTLY through the pool the
// poll service owns (`ScheduleFirePool` — one per process, the delegation
// pool's knob at the api edge), so one slow or parked fire never holds the
// rest of the batch serially behind it, and the bound holds across ticks. A
// slot is claimed only by the worker about to fire it — never up front for the
// whole batch — so a kill mid-batch loses nothing still waiting for a pool
// slot (it is still due and the next tick re-lists it). Each fire is bounded
// and locked by the api-side binder (`FireScheduleDeps`); this tick only
// decides what fires and counts how it went.
//
// `startChatTurn` + the MCP/capability composition are INJECTED via
// `FireScheduleDeps` (the leaf never imports the chat leaf or @vynel/mcp —
// invariant #2); the api-side schedules service binds the real ones. The
// repo reads/writes go through the leaf's OWN `../repositories` (schedules
// owns its schema now — the vertical-slice), not the kernel.
//
// Spec: `docs/blueprints/schedules/blueprint.md §5.4`.

import { randomUUID } from 'node:crypto'
import { Cron } from 'croner'
import { isOneTimeSchedule } from '@vynel/contracts/schedules/one-time'
import * as schedulesRepository from '../repositories/index.js'
import { fireSchedule } from './fire-schedule.js'
import type { ScheduleFirePool } from './schedule-fire-pool.js'
import type { Database } from '@vynel/db'
import type { Schedule } from '../repositories/index.js'
import type { FireScheduleDeps } from '../schedules-types.js'

export interface ScheduleTickSummary {
  /** Claimed slots the executor ran — completed or failed, the run row says which. */
  firedCount: number
  /** Overdue slots with no catch-up — one 'missed' run each, no fire. */
  missedCount: number
  /** Claimed slots whose fire THREW out of the executor before a run row could
   *  record it (a schedule disabled between claim and fire, a row write
   *  failing) — logged once here, per schedule; the poll service logs the
   *  tick's summary. A turn failure is not one of these: its run row says
   *  'failed' and the run-failed event reports it. */
  failedCount: number
  /** Due schedules left for a later tick because a fire for them was still
   *  queued or running in the pool (one fire per schedule at a time). */
  skippedCount: number
}

type DueSlotOutcome = 'fired' | 'missed' | 'failed' | 'claim-lost'

export async function runScheduleClaimAndFireTick(
  db: Database,
  deps: FireScheduleDeps,
  firePool: ScheduleFirePool,
): Promise<ScheduleTickSummary> {
  const now = new Date()
  const due = schedulesRepository.listDueSchedules(db, { now }) // isEnabled AND nextScheduledFireAt <= now

  const admitted: Array<Promise<DueSlotOutcome>> = []
  let skippedCount = 0
  for (const schedule of due) {
    const settled = firePool.admit(schedule.id, () => claimAndFireDueSlot(db, schedule, now, deps))
    if (settled === null) skippedCount += 1
    else admitted.push(settled)
  }

  const outcomes = await Promise.all(admitted)
  const count = (wanted: DueSlotOutcome): number =>
    outcomes.filter((outcome) => outcome === wanted).length
  return {
    firedCount: count('fired'),
    missedCount: count('missed'),
    failedCount: count('failed'),
    skippedCount,
  }
}

/** The worker body — runs once the fire holds a pool slot. The atomic claim
 *  happens HERE, right before the fire: advance nextScheduledFireAt ONLY if it
 *  still equals what the tick observed. A concurrent tick (or a prior
 *  process's abandoned batch) that already advanced it loses (claimed ===
 *  false) and skips — no double-fire. Nothing thrown for one schedule may
 *  abandon the rest of the batch: every throw is logged once, with the
 *  schedule id, and counted. */
async function claimAndFireDueSlot(
  db: Database,
  schedule: Schedule,
  tickStartedAt: Date,
  deps: FireScheduleDeps,
): Promise<DueSlotOutcome> {
  const observed = schedule.nextScheduledFireAt
  if (observed === null) return 'claim-lost'
  try {
    const claimed = schedulesRepository.claimDueSchedule(db, {
      id: schedule.id,
      observedNextFireAt: observed,
      nextFireAt: computeNextFireAt(schedule, tickStartedAt),
    })
    if (!claimed) return 'claim-lost'

    // The discriminator is OVERDUE-ness, not fire history — judged at the
    // TICK's clock, not the worker's: a slot that waited for a pool slot was
    // not missed offline. An on-time slot always fires 'poll'; an overdue slot
    // (Vynel was offline) either catches up once ('catchup') or records one
    // 'missed' run — never both.
    const overdue = isOverdue(observed, tickStartedAt)
    if (overdue && !schedule.catchUpOnMiss) {
      schedulesRepository.insertScheduleRun(db, {
        id: randomUUID(),
        scheduleId: schedule.id,
        scheduledFireAt: observed,
        startedAt: tickStartedAt,
        completedAt: tickStartedAt,
        chatSessionId: null,
        status: 'missed',
        statusMessage: 'Vynel was offline at the scheduled time.',
        triggerKind: 'poll',
      })
      return 'missed'
    }
    await fireSchedule(
      db,
      { scheduleId: schedule.id, scheduledFireAt: observed, triggerKind: overdue ? 'catchup' : 'poll' },
      deps,
    )
    return 'fired'
  } catch (err) {
    deps.logger?.error({ err, scheduleId: schedule.id }, 'schedule fire threw unexpectedly')
    return 'failed'
  }
}

function computeNextFireAt(schedule: Schedule, from: Date): Date | null {
  // A one-time schedule has no "next" — claiming it to null disarms it (it then
  // fails the `nextScheduledFireAt <= now` filter and is never re-listed).
  if (isOneTimeSchedule(schedule)) return null
  if (!schedule.cronExpression) return null
  try {
    return new Cron(schedule.cronExpression, { timezone: schedule.timezone }).nextRun(from)
  } catch {
    // Invalid cron — the claim still advances to null; the schedule stops
    // firing until edited.
    return null
  }
}

// "Overdue" = the slot is more than ~1.5 poll intervals in the past, i.e.
// Vynel was offline when it should have fired (vs. a slot that just came due
// this minute).
function isOverdue(scheduledFireAt: Date, now: Date): boolean {
  return now.getTime() - scheduledFireAt.getTime() > 90_000
}
