// Core op — patch a schedule (owner-scoped). Recomputes
// `nextScheduledFireAt` via croner when the cron or timezone changes;
// re-validates the channel requirement. sync.
//
// Spec: `docs/blueprints/schedules/blueprint.md §5` + coding.md §5.

import { Cron } from 'croner'
import * as schedulesRepository from '../repositories/index.js'
import { isOneTimeSchedule } from '@vynel/contracts/schedules/one-time'
import { NotFoundError, ValidationError } from '@vynel/errors'
import type { Database } from '@vynel/db'
import type {
  Schedule,
  NewSchedule,
  ScheduleDestinationKind,
} from '../repositories/index.js'

export interface UpdateScheduleInput {
  scheduleId: string
  userId: string
  displayName?: string
  cronExpression?: string
  timezone?: string
  promptTemplate?: string
  destinationKind?: ScheduleDestinationKind
  channelId?: string | null
  catchUpOnMiss?: boolean
  approvalTimeoutMsOverride?: number | null
  isEnabled?: boolean
}

export function updateSchedule(db: Database, input: UpdateScheduleInput): Schedule {
  const schedule = schedulesRepository.findScheduleById(db, input.scheduleId)
  if (!schedule || schedule.userId !== input.userId) {
    throw new NotFoundError('schedule', input.scheduleId)
  }

  // A one-time schedule fires once at a fixed time and carries no cron. A cron
  // change would desync `scheduleKind` from `cronExpression` (an inconsistent
  // row) — reject it rather than silently drop it (fail fast).
  if (isOneTimeSchedule(schedule) && input.cronExpression !== undefined) {
    throw new ValidationError(
      'A one-time schedule has no cron expression; it fires once at its scheduled time.',
    )
  }

  const patch: Partial<NewSchedule> = { updatedAt: new Date() }
  if (input.displayName !== undefined) patch.displayName = input.displayName
  if (input.promptTemplate !== undefined) patch.promptTemplate = input.promptTemplate
  if (input.catchUpOnMiss !== undefined) patch.catchUpOnMiss = input.catchUpOnMiss
  if (input.approvalTimeoutMsOverride !== undefined)
    patch.approvalTimeoutMsOverride = input.approvalTimeoutMsOverride
  if (input.isEnabled !== undefined) patch.isEnabled = input.isEnabled
  if (input.cronExpression !== undefined) patch.cronExpression = input.cronExpression
  if (input.timezone !== undefined) patch.timezone = input.timezone
  if (input.destinationKind !== undefined) patch.destinationKind = input.destinationKind
  if (input.channelId !== undefined) patch.channelId = input.channelId

  // The channel requirement is re-validated against the resulting state.
  const nextDestination = input.destinationKind ?? schedule.destinationKind
  const nextChannelId = input.channelId !== undefined ? input.channelId : schedule.channelId
  if (nextDestination === 'chat-and-channel' && !nextChannelId) {
    throw new ValidationError('A channel is required when the destination is "chat and channel".')
  }

  // Only a cron/timezone change on a RECURRING schedule moves the next-fire
  // time; otherwise the poll claim remains the sole writer of
  // nextScheduledFireAt (D9). A one-time schedule keeps its fixed fire time.
  if (
    !isOneTimeSchedule(schedule) &&
    (input.cronExpression !== undefined || input.timezone !== undefined)
  ) {
    const nextCron = input.cronExpression ?? schedule.cronExpression
    const nextTimezone = input.timezone ?? schedule.timezone
    // A recurring schedule always carries a real cron; the null-guard is
    // defensive (and satisfies the nullable column type).
    if (nextCron !== null) {
      try {
        patch.nextScheduledFireAt = new Cron(nextCron, { timezone: nextTimezone }).nextRun()
      } catch {
        throw new ValidationError(
          `Invalid cron expression "${nextCron}". Use 5-field cron, e.g. "0 9 * * MON".`,
        )
      }
    }
  }

  return schedulesRepository.updateSchedule(db, input.scheduleId, patch)
}
