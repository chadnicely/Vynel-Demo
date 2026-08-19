// The schedule-fire marker, rendered. The only session instruction with
// placeholders: the frame must NAME the schedule and its fire time or the
// model cannot tell "carry this out now" apart from a user request about the
// future (the 2026-08-20 "Tea" bug — the fired prompt read as the user asking
// for a reminder, so the model asked back and set a `sleep` timer). Rendering
// lives HERE, beside the file that declares the placeholders, so the two
// cannot drift; consumers (the schedule-fire binding) inject or import this
// function, never re-implement the fill.

import { loadSessionInstruction } from './load-session-instruction.js'

export interface RenderScheduleFireMarkerInput {
  /** The schedule's display name, e.g. "Tea". */
  scheduleDisplayName: string
  /** The fire time already rendered in the schedule's timezone, e.g.
   *  "Aug 20, 2026, 2:00 PM" — the caller owns the formatting (the schedules
   *  leaf's one home for schedule-time rendering). */
  firedAtLocal: string
}

export function renderScheduleFireMarker(input: RenderScheduleFireMarkerInput): string {
  return loadSessionInstruction('schedule-fire-marker')
    .replaceAll('{{scheduleName}}', input.scheduleDisplayName)
    .replaceAll('{{firedAtLocal}}', input.firedAtLocal)
}
