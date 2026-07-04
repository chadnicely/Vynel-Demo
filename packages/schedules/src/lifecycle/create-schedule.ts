// Core op — create a schedule from a template (or custom). sync (DB reads
// only). Computes the first `nextScheduledFireAt` via croner; throws
// ValidationError on a bad cron or a missing channel.
//
// Spec: `docs/blueprints/schedules/blueprint.md §5.1` + coding.md §5.

import { randomUUID } from 'node:crypto'
import { Cron } from 'croner'
import { findScheduleTemplateByKind } from '@vynel/contracts/schedules/schedule-template-catalog'
import * as schedulesRepository from '../repositories/index.js'
import * as usersRepository from '@vynel/db/repositories/users'
import { ValidationError } from '@vynel/errors'
import type { Database } from '@vynel/db'
import type {
  Schedule,
  ScheduleTemplateKind,
  ScheduleDestinationKind,
  ScheduleKind,
} from '../repositories/index.js'
import type { StructuralLogger } from '../schedules-types.js'

export interface CreateScheduleInput {
  userId: string
  workspaceId: string | null // null = GLOBAL scope (no workspace); a value scopes to that workspace
  templateKind: ScheduleTemplateKind
  displayName?: string
  cronExpression?: string
  timezone?: string
  promptTemplate?: string
  destinationKind?: ScheduleDestinationKind
  channelId?: string
  catchUpOnMiss?: boolean
  approvalTimeoutMsOverride?: number
  // When set, the schedule is ONE-TIME: it fires once at this absolute instant,
  // then disarms (no cron). Takes precedence over cronExpression.
  fireAt?: Date
}

export function createSchedule(
  db: Database,
  input: CreateScheduleInput,
  deps: { logger?: StructuralLogger } = {},
): Schedule {
  const template = findScheduleTemplateByKind(input.templateKind)
  if (!template) {
    throw new ValidationError(`Unknown schedule template "${input.templateKind}".`)
  }

  const timezone =
    input.timezone ?? usersRepository.findUserById(db, input.userId)?.timezone ?? 'UTC'
  const now = new Date()

  // A one-time schedule (input.fireAt set) fires once at that absolute instant,
  // then disarms — it carries a NULL cron and `scheduleKind = 'one-time'` (the
  // poll's next-fire computation returns null for it; see @vynel/contracts
  // schedules/one-time). A recurring schedule carries a real cron.
  const scheduleKind: ScheduleKind = input.fireAt !== undefined ? 'one-time' : 'recurring'
  let cronExpression: string | null
  let nextFireAt: Date | null
  if (input.fireAt !== undefined) {
    if (input.fireAt.getTime() <= now.getTime()) {
      throw new ValidationError('A one-time schedule must fire in the future.')
    }
    cronExpression = null
    nextFireAt = input.fireAt
  } else {
    cronExpression = input.cronExpression ?? template.defaultCronExpression
    try {
      nextFireAt = new Cron(cronExpression, { timezone }).nextRun()
    } catch {
      throw new ValidationError(
        `Invalid cron expression "${cronExpression}". Use 5-field cron, e.g. "0 9 * * MON".`,
      )
    }
  }

  const destinationKind = input.destinationKind ?? template.defaultDestinationKind
  if (destinationKind === 'chat-and-channel' && !input.channelId) {
    throw new ValidationError('A channel is required when the destination is "chat and channel".')
  }

  // One-time reminders default to catch-up: if Vynel was offline at the fire
  // time, deliver it late rather than silently dropping it (the poll would
  // otherwise record a 'missed' run and disarm without ever firing).
  const catchUpOnMiss =
    input.catchUpOnMiss ?? (input.fireAt !== undefined ? true : template.defaultCatchUpOnMiss)

  const schedule = schedulesRepository.insertSchedule(db, {
    id: randomUUID(),
    userId: input.userId,
    workspaceId: input.workspaceId,
    templateKind: input.templateKind,
    scheduleKind,
    displayName: input.displayName ?? template.displayLabel,
    cronExpression,
    timezone,
    promptTemplate: input.promptTemplate ?? template.promptTemplate,
    destinationKind,
    channelId: input.channelId ?? null,
    catchUpOnMiss,
    isEnabled: true,
    approvalTimeoutMsOverride:
      input.approvalTimeoutMsOverride ?? template.defaultApprovalTimeoutMsOverride,
    lastFiredAt: null,
    nextScheduledFireAt: nextFireAt,
    createdAt: now,
    updatedAt: now,
  })

  deps.logger?.info(
    { scheduleId: schedule.id, templateKind: schedule.templateKind },
    'schedule created',
  )
  return schedule
}
