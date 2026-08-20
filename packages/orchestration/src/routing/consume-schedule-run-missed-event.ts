// The `schedule.run-missed` outbox CONSUMER — a slot that passed while Vynel
// was not running (overdue, catch-up off) must reach the user, not die as a
// `missed` row on a table with no UI. Schedules publishes the event; this
// reacts by enqueueing a report delivery to the schedule's OWN scope — the
// workspace's continuing conversation for a workspace schedule, the global
// root for a global one — so the notice lands where that schedule's fires
// land. `schedules` never imports this leaf; core's registry is the seam (the
// payload shape is re-declared here, field-for-field with the producer).
//
// The `schedule:` reporter prefix is load-bearing: `isSystemReporterSessionId`
// keys the delivery's system marker and its QUIET rendering off it, which is
// what makes this a system notice rather than a colleague speaking.
//
// The times arrive already rendered in the schedule's timezone — the producer
// owns `formatScheduledTime` and this leaf cannot import it.

import { scheduleSourceLabel } from '@vynel/contracts/schedules/schedule-source-label'
import { composeMissedScheduleNotice } from '@vynel/contracts/schedules/missed-schedule-notice'
import { findWorkspaceById } from '@vynel/db/repositories/workspaces'
import { enqueueReportDelivery } from './enqueue-report-delivery.js'
import type { Database } from '@vynel/db'

// Field-for-field the payload `schedules` publishes.
export interface ScheduleRunMissedPayload {
  scheduleId: string
  runId: string
  userId: string
  workspaceId: string | null // null = GLOBAL scope (no workspace)
  channelId: string | null
  scheduleDisplayName: string
  missedAtLocal: string
  nextFireAtLocal: string | null
  missedAt: string // ISO
}

/** Returns the enqueued report-delivery job id. */
export function consumeScheduleRunMissedEvent(
  db: Database,
  payload: ScheduleRunMissedPayload,
): string {
  // A deleted workspace degrades to the global root (the task-nudge
  // precedent) — the notice still reaches the user's chat somewhere.
  const workspace =
    payload.workspaceId !== null ? findWorkspaceById(db, payload.workspaceId) : null

  return enqueueReportDelivery(db, {
    userId: payload.userId,
    // Loose provenance ref (never a FK) — a missed slot ran no turn, so there
    // is no chat session behind it at all.
    reporterSessionId: `schedule:${payload.scheduleId}`,
    reporterLabel: scheduleSourceLabel(payload.scheduleDisplayName),
    // ONE finished human-readable line — the same words the channel leg sends,
    // so the two never tell different stories about the same silent moment —
    // plus a RELAY steer. The system-notification steer this rides under says
    // "act on it per your standing instructions", which on a bare statement of
    // fact invites the model to run the missed work or invent a replacement
    // schedule (the class of bug the fire frame exists to prevent). The steer
    // stays out of `composeMissedScheduleNotice` — the channel leg must carry
    // the sentence alone, never an instruction to a model.
    reportBody:
      composeMissedScheduleNotice({
        scheduleDisplayName: payload.scheduleDisplayName,
        missedAtLocal: payload.missedAtLocal,
        nextFireAtLocal: payload.nextFireAtLocal,
      }) +
      '\n\nJust tell the user this. Do not carry out the missed work now and do not create a ' +
      'timer or a replacement schedule — if they want it run, they will ask.',
    requester:
      workspace !== null
        ? {
            kind: 'workspace-primary',
            workspaceId: workspace.id,
            workspacePath: workspace.path,
          }
        : { kind: 'global-root' },
  })
}
