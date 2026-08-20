// The turn-time marker, rendered. A model reads no clock: without this a turn
// answered "02:51 + 15 minutes = 2:07" because nothing on the turn said what
// time it is. Every interactive turn carries it, so — unlike the schedule
// marker, whose time comes from the schedules leaf — the formatting lives HERE
// beside the placeholders it fills, and the caller passes only the instant and
// the zone (which keeps it testable against a fixed clock).

import { loadSessionInstruction } from './load-session-instruction.js'

/** The user's wall clock, weekday included — a relative answer ("tomorrow
 *  morning") needs the day as much as the hour. An unusable IANA zone falls
 *  back to the ISO instant rather than silently rendering someone else's
 *  local time. */
function formatWallClock(now: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(now)
  } catch {
    return now.toISOString()
  }
}

export function renderTurnTimeMarker(now: Date, timeZone: string): string {
  return loadSessionInstruction('turn-time-marker')
    .replaceAll('{{nowLocal}}', formatWallClock(now, timeZone))
    .replaceAll('{{timezone}}', timeZone)
}
