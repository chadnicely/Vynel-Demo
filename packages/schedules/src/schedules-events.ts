// The outbox event this domain publishes. The payload MUST match channels'
// `ScheduleRunCompletedPayload` (channels/blueprint.md §9) field-for-field —
// channels enqueues `renderedOutput` VERBATIM as the channel message body
// (the 📅 header is already baked in by `renderScheduleChannelMessage`).
//
// Spec: `docs/blueprints/schedules/coding.md §3` + blueprint §8.

export const SCHEDULE_RUN_COMPLETED_EVENT_TYPE = 'schedule.run-completed' as const

export interface ScheduleRunCompletedPayload {
  scheduleId: string
  userId: string
  workspaceId: string
  channelId: string
  chatSessionId: string
  renderedOutput: string // the channel body — the 📅 header is already baked in
  firedAt: string // ISO
}
