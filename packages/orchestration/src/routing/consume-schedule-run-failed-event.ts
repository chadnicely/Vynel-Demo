// The `schedule.run-failed` outbox CONSUMER — a failed schedule run must reach
// the user's chat, not die as a row on a table with no UI. Schedules publishes
// the event; this reacts by enqueueing a GLOBAL-ROOT report delivery, so the
// failure arrives on the root conversation through the same notify-turn engine
// every other cross-session report rides. `schedules` never imports this leaf —
// core's registry is the seam (loose cross-domain contract: the payload shape
// is re-declared here, field-for-field with the producer).

import { enqueueReportDelivery } from './enqueue-report-delivery.js'
import type { Database } from '@vynel/db'

// Field-for-field the payload `schedules` publishes.
export interface ScheduleRunFailedPayload {
  scheduleId: string
  runId: string
  userId: string
  workspaceId: string | null
  scheduleDisplayName: string
  errorMessage: string
  firedAt: string // ISO
}

/** Returns the enqueued report-delivery job id. */
export function consumeScheduleRunFailedEvent(
  db: Database,
  payload: ScheduleRunFailedPayload,
): string {
  return enqueueReportDelivery(db, {
    userId: payload.userId,
    // Loose provenance ref (never a FK) — there may be no chat session at all
    // when the fire failed before the turn started.
    reporterSessionId: `schedule:${payload.scheduleId}`,
    reporterLabel: `Schedule · ${payload.scheduleDisplayName}`,
    reportBody:
      `The scheduled task "${payload.scheduleDisplayName}" failed to run at ${payload.firedAt}: ` +
      `${payload.errorMessage}. Tell the user it failed, and if the cause is something they can ` +
      `fix (a deleted workspace, a disconnected channel), say what would fix it.`,
    requester: { kind: 'global-root' },
  })
}
