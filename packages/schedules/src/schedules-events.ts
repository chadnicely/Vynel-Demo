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
