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

// ── Response schemas ────────────────────────────────────────────────
// Structurally mirror `ScheduleResponse` / `ScheduleRunResponse` from
// `@vynel/contracts/schedules/schedule-http` (the type
// `serializeScheduleForResponse` / `serializeScheduleRunForResponse` are cast
// to). Declared here — not inverted to `z.infer` — because the canonical
// type lives in the shared contracts package, not in this route's
// serializer; the schema exists so `describeRoute` can attach a real
// OpenAPI response body via `resolver()` (the workspaces precedent).

const ScheduleTemplateKindResponseSchema = z.enum([
  'morning-briefing',
  'weekly-summary',
  'email-watch',
  'custom',
  'reminder',
])

const ScheduleDestinationKindResponseSchema = z.enum(['chat-only', 'chat-and-channel'])

const ScheduleKindResponseSchema = z.enum(['recurring', 'one-time'])

export const ScheduleResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  // Null = GLOBAL scope — a user-level schedule with no workspace.
  workspaceId: z.string().nullable(),
  templateKind: ScheduleTemplateKindResponseSchema,
  scheduleKind: ScheduleKindResponseSchema,
  displayName: z.string(),
  // Null for a one-time schedule (it fires by nextScheduledFireAt, not a cron).
  cronExpression: z.string().nullable(),
  timezone: z.string(),
  promptTemplate: z.string(),
  destinationKind: ScheduleDestinationKindResponseSchema,
  channelId: z.string().nullable(),
  catchUpOnMiss: z.boolean(),
  isEnabled: z.boolean(),
  approvalTimeoutMsOverride: z.number().nullable(),
  lastFiredAt: z.string().nullable(), // ISO-8601 or null
  nextScheduledFireAt: z.string().nullable(), // ISO-8601 or null
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const ListSchedulesResponseSchema = z.array(ScheduleResponseSchema)

const ScheduleRunStatusResponseSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'missed',
])

const ScheduleRunTriggerKindResponseSchema = z.enum(['poll', 'catchup', 'manual'])

export const ScheduleRunResponseSchema = z.object({
  id: z.string(),
  scheduleId: z.string(),
  scheduledFireAt: z.string(), // ISO-8601
  startedAt: z.string(), // ISO-8601
  completedAt: z.string().nullable(), // ISO-8601 or null
  chatSessionId: z.string().nullable(),
  status: ScheduleRunStatusResponseSchema,
  statusMessage: z.string().nullable(),
  triggerKind: ScheduleRunTriggerKindResponseSchema,
})

export const ListScheduleRunsResponseSchema = z.array(ScheduleRunResponseSchema)

// GET /templates catalog — mirrors `ScheduleTemplateDefinition` from
// `@vynel/contracts/schedules/schedule-template-catalog`.
export const ScheduleTemplateResponseSchema = z.object({
  templateKind: ScheduleTemplateKindResponseSchema,
  displayLabel: z.string(),
  oneLineDescription: z.string(),
  iconName: z.string(),
  defaultCronExpression: z.string(),
  defaultDestinationKind: ScheduleDestinationKindResponseSchema,
  defaultCatchUpOnMiss: z.boolean(),
  defaultApprovalTimeoutMsOverride: z.number().nullable(),
  promptTemplate: z.string(),
  recommendedFor: z.string(),
  // Opt-in — absent/false means the normal MCP-equipped LLM turn runs.
  deliversVerbatim: z.boolean().optional(),
})

export const ListScheduleTemplatesResponseSchema = z.array(ScheduleTemplateResponseSchema)
