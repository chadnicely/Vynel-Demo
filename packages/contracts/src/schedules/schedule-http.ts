// HTTP response shapes for the `schedules` domain. Single source of truth for
// the serialized response: `apps/local-api` types `serializeScheduleForResponse`'s
// return as `ScheduleResponse`; `apps/web` casts SDK responses to these (the
// routes carry no response schema in the OpenAPI spec, so the SDK can't infer
// — the workspaces/channels cast-from-contracts precedent).
//
// Union types re-declared locally — `@vynel/contracts` has no `@vynel/db` dep
// (the workspaces/channels precedent; kept in sync with the schema files).

export type ScheduleTemplateKind =
  | 'morning-briefing'
  | 'weekly-summary'
  | 'email-watch'
  | 'custom'
  | 'reminder'
export type ScheduleDestinationKind = 'chat-only' | 'chat-and-channel'
export type ScheduleRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'missed'
export type ScheduleRunTriggerKind = 'poll' | 'catchup' | 'manual'

export interface ScheduleResponse {
  id: string
  userId: string
  workspaceId: string
  templateKind: ScheduleTemplateKind
  displayName: string
  cronExpression: string
  timezone: string
  promptTemplate: string
  destinationKind: ScheduleDestinationKind
  channelId: string | null
  catchUpOnMiss: boolean
  isEnabled: boolean
  approvalTimeoutMsOverride: number | null
  /** ISO-8601 or null */
  lastFiredAt: string | null
  /** ISO-8601 or null */
  nextScheduledFireAt: string | null
  /** ISO-8601 */
  createdAt: string
  /** ISO-8601 */
  updatedAt: string
}

export interface ScheduleRunResponse {
  id: string
  scheduleId: string
  /** ISO-8601 */
  scheduledFireAt: string
  /** ISO-8601 */
  startedAt: string
  /** ISO-8601 or null */
  completedAt: string | null
  chatSessionId: string | null
  status: ScheduleRunStatus
  statusMessage: string | null
  triggerKind: ScheduleRunTriggerKind
}
