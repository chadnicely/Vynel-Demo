// The ONE wording of "your schedule did not run". A missed slot (overdue with
// catch-up off) is announced on TWO legs — the chat notice the orchestration
// consumer delivers and the channel push the channels one enqueues — and the
// two drifting apart would tell the user two different stories about the same
// silent moment. Lives beside `scheduleSourceLabel` for the same reason.
//
// The local times arrive already rendered in the schedule's own timezone: the
// producer (the poll tick) owns `formatScheduledTime`, and neither consumer
// may import the schedules leaf.

import { scheduleSourceLabel } from './schedule-source-label.js'

export interface MissedScheduleNoticeInput {
  scheduleDisplayName: string
  /** The slot that passed, rendered in the schedule's timezone. */
  missedAtLocal: string
  /** The next armed slot in the schedule's timezone — null once disarmed. */
  nextFireAtLocal: string | null
}

/** The user-facing line for a slot Vynel was not running for. */
export function composeMissedScheduleNotice(input: MissedScheduleNoticeInput): string {
  const nextRun = input.nextFireAtLocal ?? 'none'
  return (
    `📅 ${scheduleSourceLabel(input.scheduleDisplayName)} missed its ${input.missedAtLocal} run ` +
    `(Vynel was not running); next run ${nextRun}`
  )
}
