// Zod request/query schemas for `schedules` routes. XxxSchema suffix;
// API-internal (single consumer) so they live beside the routes
// (coding-standard.md "Zod schemas"). Validated via `validator` from
// `hono-openapi/zod`.
//
// Per `docs/blueprints/schedules/blueprint.md §6`.

import { z } from 'zod'

export const ScheduleParamSchema = z.object({
  scheduleId: z.string().min(1),
})

export const CreateScheduleRequestSchema = z.object({
  templateKind: z.enum(['morning-briefing', 'weekly-summary', 'email-watch', 'custom', 'reminder']),
  displayName: z.string().min(1).max(200).optional(),
  cronExpression: z.string().min(1).max(120).optional(),
  timezone: z.string().min(1).max(80).optional(),
  promptTemplate: z.string().min(1).max(8000).optional(),
  destinationKind: z.enum(['chat-only', 'chat-and-channel']).optional(),
  channelId: z.string().min(1).optional(),
  catchUpOnMiss: z.boolean().optional(),
  approvalTimeoutMsOverride: z.number().int().positive().optional(),
  // When set, creates a ONE-TIME schedule that fires once at this instant, then
  // disarms (e.g. "remind me in 15 minutes"). Mutually exclusive with cron in
  // practice — fireAt takes precedence. ISO-8601; must be in the future.
  fireAt: z.string().datetime({ offset: true }).optional(),
})

// The user-scoped `POST /schedules` body. `scope` discriminates a GLOBAL
// schedule (no workspace) from a WORKSPACE schedule; the discriminated union
// makes `workspaceId` REQUIRED in the workspace branch, so the validator
// rejects a workspace scope missing it with 400 at the boundary — no
// route-level check. Exposes BOTH `cronExpression` (recurring) and `fireAt`
// (one-time), like the workspace-scoped create.
const createScheduleFields = {
  templateKind: z.enum(['morning-briefing', 'weekly-summary', 'email-watch', 'custom', 'reminder']),
  displayName: z.string().min(1).max(200).optional(),
  cronExpression: z.string().min(1).max(120).optional(),
  timezone: z.string().min(1).max(80).optional(),
  promptTemplate: z.string().min(1).max(8000).optional(),
  destinationKind: z.enum(['chat-only', 'chat-and-channel']).optional(),
  channelId: z.string().min(1).optional(),
  catchUpOnMiss: z.boolean().optional(),
  approvalTimeoutMsOverride: z.number().int().positive().optional(),
  fireAt: z.string().datetime({ offset: true }).optional(),
}

export const CreateScheduleForUserRequestSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('global'), ...createScheduleFields }),
  z.object({ scope: z.literal('workspace'), workspaceId: z.string().min(1), ...createScheduleFields }),
])

export const UpdateScheduleRequestSchema = z.object({
  displayName: z.string().min(1).max(200).optional(),
  cronExpression: z.string().min(1).max(120).optional(),
  timezone: z.string().min(1).max(80).optional(),
  promptTemplate: z.string().min(1).max(8000).optional(),
  destinationKind: z.enum(['chat-only', 'chat-and-channel']).optional(),
  channelId: z.string().min(1).nullable().optional(),
  catchUpOnMiss: z.boolean().optional(),
  approvalTimeoutMsOverride: z.number().int().positive().nullable().optional(),
  isEnabled: z.boolean().optional(),
})

export const ListScheduleRunsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  // Keyset cursor on (startedAt, id). Both required to page.
  cursorStartedAt: z.string().optional(), // ISO-8601
  cursorId: z.string().optional(),
})
