// The outbox event this domain publishes. The payload MUST match channels'
// `ScheduleRunCompletedPayload` (channels/blueprint.md §9) field-for-field —
// channels enqueues `renderedOutput` VERBATIM as the channel message body
// (the 📅 header is already baked in by `renderScheduleChannelMessage`).
//
// Spec: `docs/blueprints/schedules/coding.md §3` + blueprint §8.

export const SCHEDULE_RUN_COMPLETED_EVENT_TYPE = 'schedule.run-completed' as const

// A failed run publishes its own event: the failure must reach the user's chat
// (core's registry routes it into a global-root report delivery) and be
// watchable by monitors — a `failed` row on a table with no UI is invisible.
export const SCHEDULE_RUN_FAILED_EVENT_TYPE = 'schedule.run-failed' as const

export interface ScheduleRunFailedPayload {
  scheduleId: string
  runId: string
  userId: string
  // Nullable to match the schema — a GLOBAL schedule (NULL workspace) fails too.
  workspaceId: string | null
  scheduleDisplayName: string
  errorMessage: string
  firedAt: string // ISO
}

// A MISSED slot publishes its own event too (schedule-gaps G1): an overdue
// slot with catch-up off used to write a `missed` run row and tell NOBODY —
// the user simply never heard that the moment passed. Co-committed with that
// row (invariant #5); two consumers react (the chat notice + the channel push
// when the destination has one).
export const SCHEDULE_RUN_MISSED_EVENT_TYPE = 'schedule.run-missed' as const

export interface ScheduleRunMissedPayload {
  scheduleId: string
  runId: string
  userId: string
  // Nullable to match the schema — a GLOBAL schedule (NULL workspace) misses too.
  workspaceId: string | null
  // The channel to also tell, or null (chat-only, or no channel bound). A
  // loose ref, like every other channel id schedules carries.
  channelId: string | null
  scheduleDisplayName: string
  // Both times are rendered PRODUCER-side in the schedule's own timezone: the
  // consumers live in leaves that cannot import this one's `formatScheduledTime`.
  missedAtLocal: string
  // The slot the claim just armed — null once a one-time schedule disarms.
  nextFireAtLocal: string | null
  missedAt: string // ISO
}

export interface ScheduleRunCompletedPayload {
  scheduleId: string
  userId: string
  // Nullable to match the schema — a GLOBAL schedule (NULL workspace) that
  // delivers to a channel emits this event with a null workspaceId.
  workspaceId: string | null
  channelId: string
  chatSessionId: string
  renderedOutput: string // the channel body — the 📅 header is already baked in
  firedAt: string // ISO
}
