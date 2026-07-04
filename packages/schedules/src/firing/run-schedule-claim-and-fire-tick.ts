// The per-minute poll body. Claims each due schedule with an atomic
// compare-and-swap on `nextScheduledFireAt` BEFORE firing, so overlapping
// ticks can never double-fire the same slot. The claim is the ONLY place
// nextScheduledFireAt advances — to the next croner slot, past the whole
// overdue window in one step. Catch-up folds in here: an overdue slot fires
// once for the observed slot (if catchUpOnMiss) or records a single 'missed'
// run; never both, never a flood. async (each fire drives the provider
// stream).
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
import type { Database } from '@vynel/db'
import type { Schedule } from '../repositories/index.js'
import type { FireScheduleDeps } from '../schedules-types.js'

export async function runScheduleClaimAndFireTick(
  db: Database,
  deps: FireScheduleDeps,
): Promise<{ firedCount: number; missedCount: number }> {
  const now = new Date()
  const due = schedulesRepository.listDueSchedules(db, { now }) // isEnabled AND nextScheduledFireAt <= now
  let firedCount = 0
  let missedCount = 0

  for (const schedule of due) {
    const observed = schedule.nextScheduledFireAt
    if (!observed) continue

    const nextFireAt = computeNextFireAt(schedule, now)

    // Atomic claim: advance nextScheduledFireAt ONLY if it still equals what
    // we observed. A concurrent tick that already advanced it loses here
    // (claimed === false) and skips — no double-fire.
    const claimed = schedulesRepository.claimDueSchedule(db, {
      id: schedule.id,
      observedNextFireAt: observed,
      nextFireAt,
    })
    if (!claimed) continue

    // The discriminator is OVERDUE-ness, not fire history. An on-time slot
    // always fires 'poll'; an overdue slot (Vynel was offline) either catches
    // up once ('catchup') or records one 'missed' run — never both.
    if (!isOverdue(observed, now)) {
      await fireSchedule(
        db,
        { scheduleId: schedule.id, scheduledFireAt: observed, triggerKind: 'poll' },
        deps,
      )
      firedCount++
    } else if (schedule.catchUpOnMiss) {
      await fireSchedule(
        db,
        { scheduleId: schedule.id, scheduledFireAt: observed, triggerKind: 'catchup' },
        deps,
      )
      firedCount++
    } else {
      // Overdue slot, no catch-up — record one 'missed' run and move on.
      schedulesRepository.insertScheduleRun(db, {
        id: randomUUID(),
        scheduleId: schedule.id,
        scheduledFireAt: observed,
        startedAt: now,
        completedAt: now,
        chatSessionId: null,
        status: 'missed',
        statusMessage: 'Vynel was offline at the scheduled time.',
        triggerKind: 'poll',
      })
      missedCount++
    }
  }

  return { firedCount, missedCount }
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
