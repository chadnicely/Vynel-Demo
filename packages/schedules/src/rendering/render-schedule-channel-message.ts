// Core op — build the channel message body for a fired schedule. The 📅
// header is product message CONTENT (not Vynel status-UI) — kept per
// decisions.md "emoji". The full string becomes the outbox event's
// `renderedOutput`, which channels enqueues VERBATIM (channels adds no
// header). sync, pure.
//
// Spec: `docs/blueprints/schedules/blueprint.md §5.5` + coding.md §1.6.

import type { Schedule } from '../repositories/index.js'

export function renderScheduleChannelMessage(
  schedule: Schedule,
  assistantText: string,
  firedAt: Date,
): string {
  const header = `📅 ${schedule.displayName} • ${formatScheduledTime(firedAt, schedule.timezone)}`
  return `${header}\n\n${assistantText}`
}

/** The one home for rendering a fire time in the schedule's own timezone —
 *  the channel header above and the fired prompt's model-facing frame both
 *  read it, so "when it fired" never renders two ways. */
export function formatScheduledTime(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date)
  } catch {
    // An invalid IANA timezone string falls back to a stable ISO rendering.
    return date.toISOString()
  }
}
