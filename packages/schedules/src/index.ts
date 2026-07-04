// Public surface of `@vynel/schedules` — the schedules leaf. Consumers reach the
// package only through this barrel; schema, repositories and the concern folders
// are internal (imported relatively). The per-minute claim-and-fire TICK runner
// is the worker-cron composition body — deferred to app-wiring.

export type { StructuralLogger, FireScheduleDeps } from './schedules-types.js'

export {
  SCHEDULE_RUN_COMPLETED_EVENT_TYPE,
  type ScheduleRunCompletedPayload,
} from './schedules-events.js'

// CRUD + render ops (sync).
export { createSchedule, type CreateScheduleInput } from './lifecycle/create-schedule.js'
export { listSchedules } from './queries/list-schedules.js'
export { updateSchedule, type UpdateScheduleInput } from './lifecycle/update-schedule.js'
export { setScheduleEnabled } from './lifecycle/set-schedule-enabled.js'
export { deleteSchedule } from './lifecycle/delete-schedule.js'
export { listScheduleTemplates } from './queries/list-schedule-templates.js'
export { listScheduleRuns, type ListScheduleRunsInput } from './queries/list-schedule-runs.js'
export { renderSchedulePrompt } from './rendering/render-schedule-prompt.js'
export { renderScheduleChannelMessage } from './rendering/render-schedule-channel-message.js'

// Fire path (async — drives the provider stream).
export { fireSchedule, type FireScheduleInput } from './firing/fire-schedule.js'
export { manualFireSchedule } from './firing/manual-fire-schedule.js'
