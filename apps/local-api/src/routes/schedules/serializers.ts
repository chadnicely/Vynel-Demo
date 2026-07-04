// Response serializers for `schedules` HTTP routes. Date columns emit as ISO
// strings. Unlike channels there is no secret field to strip — the whole row
// is owner-visible. Single source of truth for the response shapes is
// `@vynel/contracts/schedules/schedule-http` (`apps/web` casts SDK responses
// to it — the channels/workspaces cast-from-contracts precedent).

import type { Schedule, ScheduleRun } from '@vynel/schedules'
import type {
  ScheduleResponse,
  ScheduleRunResponse,
} from '@vynel/contracts/schedules/schedule-http'

export function serializeScheduleForResponse(schedule: Schedule): ScheduleResponse {
  return {
    id: schedule.id,
    userId: schedule.userId,
    workspaceId: schedule.workspaceId,
    templateKind: schedule.templateKind,
    displayName: schedule.displayName,
    cronExpression: schedule.cronExpression,
    timezone: schedule.timezone,
    promptTemplate: schedule.promptTemplate,
    destinationKind: schedule.destinationKind,
    channelId: schedule.channelId,
    catchUpOnMiss: schedule.catchUpOnMiss,
    isEnabled: schedule.isEnabled,
    approvalTimeoutMsOverride: schedule.approvalTimeoutMsOverride,
    lastFiredAt: schedule.lastFiredAt ? schedule.lastFiredAt.toISOString() : null,
    nextScheduledFireAt: schedule.nextScheduledFireAt
      ? schedule.nextScheduledFireAt.toISOString()
      : null,
    createdAt: schedule.createdAt.toISOString(),
    updatedAt: schedule.updatedAt.toISOString(),
  }
}

export function serializeScheduleRunForResponse(run: ScheduleRun): ScheduleRunResponse {
  return {
    id: run.id,
    scheduleId: run.scheduleId,
    scheduledFireAt: run.scheduledFireAt.toISOString(),
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt ? run.completedAt.toISOString() : null,
    chatSessionId: run.chatSessionId,
    status: run.status,
    statusMessage: run.statusMessage,
    triggerKind: run.triggerKind,
  }
}
