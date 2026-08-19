// The `schedules` HTTP surface — mounted under
// `/workspaces/:workspaceId/schedules` from `apps/local-api/src/app.ts`:
//
//   GET    /                       -> listSchedules            [x-mcp]
//   GET    /templates              -> listScheduleTemplates    [x-mcp]
//   POST   /                       -> createSchedule (cron OR one-time fireAt)
//   PATCH  /:scheduleId            -> updateSchedule
//   POST   /:scheduleId/enable     -> setScheduleEnabled(true)
//   POST   /:scheduleId/disable    -> setScheduleEnabled(false)
//   POST   /:scheduleId/fire-now   -> manualFireSchedule (drives a headless turn)
//   DELETE /:scheduleId            -> deleteSchedule (hard-delete, cascades)
//   GET    /:scheduleId/runs       -> listScheduleRuns         [x-mcp]
//
// Locked Hono protocol: `describeRoute` (from the local openapi.js wrapper —
// widens the type for x-mcp + x-sdk-name) → `validator` (from hono-openapi/zod)
// → `...workspaceScoped` → handler. Chained methods on `factory.createApp()`.
// Handlers THROW typed VynelError subclasses; the app.ts onError middleware
// maps them (no inline `c.json({code}, 4xx)`).
//
// MCP exposure (D14): the three safe-read GETs carry x-mcp pre-annotations
// (list_schedules / list_schedule_templates / list_schedule_runs). No mutating
// route is exposed — ESPECIALLY not fire-now (it DRIVES a turn, never an agent
// tool).
//
// `fire-now` builds the fire path's `FireScheduleDeps` from `c.var.appRequest`
// via `buildScheduleFireDeps` (the ③ agent-turn MCP binding) and calls
// `manualFireSchedule`. To stay testable WITHOUT a live AI turn, an injected
// `c.var.scheduleFireDeps` (set via `createApp` options) overrides the real
// build — a route test fires with a FAKE `startChatTurn`.
//
// Spec: `docs/blueprints/schedules/blueprint.md §6` + coding.md §6.

import { resolver, validator } from 'hono-openapi/zod'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { workspaceScoped } from '../../handler-bundles/workspace-scoped.js'
import { buildScheduleFireDeps } from '../../sessions/build-schedule-fire-deps.js'
import { buildEnabledFeatureKeysReader } from '../../sessions/enabled-feature-keys.js'
import {
  createSchedule,
  listSchedules,
  updateSchedule,
  setScheduleEnabled,
  deleteSchedule,
  listScheduleTemplates,
  listScheduleRuns,
  manualFireSchedule,
} from '@vynel/schedules'
import { serializeScheduleForResponse, serializeScheduleRunForResponse } from './serializers.js'
import {
  ScheduleParamSchema,
  CreateScheduleRequestSchema,
  UpdateScheduleRequestSchema,
  ListScheduleRunsQuerySchema,
  ScheduleResponseSchema,
  ListSchedulesResponseSchema,
  ScheduleRunResponseSchema,
  ListScheduleRunsResponseSchema,
  ListScheduleTemplatesResponseSchema,
} from './schemas.js'

export const schedulesApp = factory
  .createApp()
  // GET / — list the workspace's schedules (owner-scoped).
  .get(
    '/',
    describeRoute({
      tags: ['schedules'],
      summary: 'List schedules for the active workspace (owner-scoped).',
      'x-sdk-name': 'schedules.list',
      responses: {
        200: {
          description: 'Array of Schedule.',
          content: { 'application/json': { schema: resolver(ListSchedulesResponseSchema) } },
        },
        404: { description: 'Workspace not found.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'list_schedules',
        description:
          'List the scheduled routines for the active workspace (owner-scoped). Returns each ' +
          'schedule with its cron expression, destination, enabled flag, and next fire time.',
      },
    }),
    ...workspaceScoped,
    (c) => {
      const schedules = listSchedules(c.var.db, {
        userId: c.var.user.id,
        workspaceId: c.var.workspace!.id,
      })
      return c.json(schedules.map(serializeScheduleForResponse))
    },
  )
  // GET /templates — the built-in template catalog.
  .get(
    '/templates',
    describeRoute({
      tags: ['schedules'],
      summary: 'List the available schedule templates.',
      'x-sdk-name': 'schedules.listTemplates',
      responses: {
        200: {
          description: 'Array of ScheduleTemplateDefinition.',
          content: {
            'application/json': { schema: resolver(ListScheduleTemplatesResponseSchema) },
          },
        },
      },
      'x-mcp': {
        exposed: true,
        name: 'list_schedule_templates',
        description:
          'List the built-in schedule templates (morning briefing, weekly summary, email watch, custom).',
      },
    }),
    ...workspaceScoped,
    (c) => c.json(listScheduleTemplates()),
  )
  // POST / — create a schedule (from a template or custom; cron OR one-time fireAt).
  .post(
    '/',
    describeRoute({
      tags: ['schedules'],
      summary: 'Create a schedule (from a template or custom).',
      'x-sdk-name': 'schedules.create',
      responses: {
        201: {
          description: 'Schedule created.',
          content: { 'application/json': { schema: resolver(ScheduleResponseSchema) } },
        },
        400: { description: 'Invalid cron or missing channel.' },
      },
    }),
    validator('json', CreateScheduleRequestSchema),
    ...workspaceScoped,
    (c) => {
      const body = c.req.valid('json')
      // Explicit field mapping + conditional spread — the validated body's
      // optionals are `T | undefined` (Zod), which can't bulk-spread into the
      // exactOptional core input (the channels connect-route precedent).
      const schedule = createSchedule(
        c.var.db,
        {
          userId: c.var.user.id,
          workspaceId: c.var.workspace!.id,
          templateKind: body.templateKind,
          ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
          ...(body.cronExpression !== undefined ? { cronExpression: body.cronExpression } : {}),
          ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
          ...(body.promptTemplate !== undefined ? { promptTemplate: body.promptTemplate } : {}),
          ...(body.destinationKind !== undefined ? { destinationKind: body.destinationKind } : {}),
          ...(body.channelId !== undefined ? { channelId: body.channelId } : {}),
          ...(body.catchUpOnMiss !== undefined ? { catchUpOnMiss: body.catchUpOnMiss } : {}),
          ...(body.approvalTimeoutMsOverride !== undefined
            ? { approvalTimeoutMsOverride: body.approvalTimeoutMsOverride }
            : {}),
          ...(body.fireAt !== undefined ? { fireAt: new Date(body.fireAt) } : {}),
        },
        { logger: c.var.logger },
      )
      return c.json(serializeScheduleForResponse(schedule), 201)
    },
  )
  // PATCH /:scheduleId — update a schedule (recomputes next-fire on cron change).
  .patch(
    '/:scheduleId',
    describeRoute({
      tags: ['schedules'],
      summary: 'Update a schedule.',
      'x-sdk-name': 'schedules.update',
      responses: {
        200: {
          description: 'Schedule updated.',
          content: { 'application/json': { schema: resolver(ScheduleResponseSchema) } },
        },
        400: { description: 'Invalid cron or missing channel.' },
        404: { description: 'No such schedule in this workspace.' },
      },
    }),
    validator('param', ScheduleParamSchema),
    validator('json', UpdateScheduleRequestSchema),
    ...workspaceScoped,
    (c) => {
      const { scheduleId } = c.req.valid('param')
      const body = c.req.valid('json')
      const schedule = updateSchedule(c.var.db, {
        scheduleId,
        userId: c.var.user.id,
        ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
        ...(body.cronExpression !== undefined ? { cronExpression: body.cronExpression } : {}),
        ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
        ...(body.promptTemplate !== undefined ? { promptTemplate: body.promptTemplate } : {}),
        ...(body.destinationKind !== undefined ? { destinationKind: body.destinationKind } : {}),
        ...(body.channelId !== undefined ? { channelId: body.channelId } : {}),
        ...(body.catchUpOnMiss !== undefined ? { catchUpOnMiss: body.catchUpOnMiss } : {}),
        ...(body.approvalTimeoutMsOverride !== undefined
          ? { approvalTimeoutMsOverride: body.approvalTimeoutMsOverride }
          : {}),
        ...(body.isEnabled !== undefined ? { isEnabled: body.isEnabled } : {}),
      })
      return c.json(serializeScheduleForResponse(schedule))
    },
  )
  // POST /:scheduleId/enable — turn a schedule on.
  .post(
    '/:scheduleId/enable',
    describeRoute({
      tags: ['schedules'],
      summary: 'Enable a schedule.',
      'x-sdk-name': 'schedules.enable',
      responses: {
        200: {
          description: 'Schedule enabled.',
          content: { 'application/json': { schema: resolver(ScheduleResponseSchema) } },
        },
        404: { description: 'No such schedule in this workspace.' },
      },
    }),
    validator('param', ScheduleParamSchema),
    ...workspaceScoped,
    (c) => {
      const schedule = setScheduleEnabled(c.var.db, {
        scheduleId: c.req.valid('param').scheduleId,
        userId: c.var.user.id,
        isEnabled: true,
      })
      return c.json(serializeScheduleForResponse(schedule))
    },
  )
  // POST /:scheduleId/disable — turn a schedule off (recoverable; not deletion).
  .post(
    '/:scheduleId/disable',
    describeRoute({
      tags: ['schedules'],
      summary: 'Disable a schedule.',
      'x-sdk-name': 'schedules.disable',
      responses: {
        200: {
          description: 'Schedule disabled.',
          content: { 'application/json': { schema: resolver(ScheduleResponseSchema) } },
        },
        404: { description: 'No such schedule in this workspace.' },
      },
    }),
    validator('param', ScheduleParamSchema),
    ...workspaceScoped,
    (c) => {
      const schedule = setScheduleEnabled(c.var.db, {
        scheduleId: c.req.valid('param').scheduleId,
        userId: c.var.user.id,
        isEnabled: false,
      })
      return c.json(serializeScheduleForResponse(schedule))
    },
  )
  // POST /:scheduleId/fire-now — a manual run (does NOT affect the next fire).
  // Drives a headless workspace turn via the injected fire deps; NEVER an MCP
  // tool (no x-mcp — it IS a turn).
  .post(
    '/:scheduleId/fire-now',
    describeRoute({
      tags: ['schedules'],
      summary: 'Fire a schedule immediately (a manual run; does not affect the next scheduled fire).',
      'x-sdk-name': 'schedules.fireNow',
      responses: {
        202: {
          description: 'Run started.',
          content: { 'application/json': { schema: resolver(ScheduleRunResponseSchema) } },
        },
        404: { description: 'No such schedule in this workspace.' },
        409: { description: 'The schedule is paused.' },
      },
    }),
    validator('param', ScheduleParamSchema),
    ...workspaceScoped,
    async (c) => {
      // The injected deps (test) fire with a fake turn; otherwise build the real
      // deps once, closing over the in-process appRequest (the fileWatcher-style
      // boot seam). No logic in the route — build deps + call core + serialize.
      const fireDeps =
        c.var.scheduleFireDeps ??
        (await buildScheduleFireDeps({
          appRequest: c.var.appRequest,
          logger: c.var.logger,
          activityFeed: c.var.activityFeed,
          targetLocks: c.var.sessionTargetLocks,
          turnEvents: c.var.turnEvents,
          readEnabledFeatureKeys: buildEnabledFeatureKeysReader(c.var.hubSession),
        }))
      const run = await manualFireSchedule(
        c.var.db,
        { scheduleId: c.req.valid('param').scheduleId, userId: c.var.user.id },
        fireDeps,
      )
      return c.json(serializeScheduleRunForResponse(run), 202)
    },
  )
  // DELETE /:scheduleId — hard-delete (cascades to runs). No soft-delete (D11).
  .delete(
    '/:scheduleId',
    describeRoute({
      tags: ['schedules'],
      summary: 'Delete a schedule (hard delete; cascades to its run history).',
      'x-sdk-name': 'schedules.delete',
      responses: {
        204: { description: 'Schedule deleted.' },
        404: { description: 'No such schedule in this workspace.' },
      },
    }),
    validator('param', ScheduleParamSchema),
    ...workspaceScoped,
    (c) => {
      deleteSchedule(c.var.db, {
        scheduleId: c.req.valid('param').scheduleId,
        userId: c.var.user.id,
      })
      return c.body(null, 204)
    },
  )
  // GET /:scheduleId/runs — the run history (owner-scoped, keyset-paginated).
  .get(
    '/:scheduleId/runs',
    describeRoute({
      tags: ['schedules'],
      summary: 'List a schedule’s run history (owner-scoped, newest first, keyset-paginated).',
      'x-sdk-name': 'schedules.listRuns',
      responses: {
        200: {
          description: 'Array of ScheduleRun (newest first).',
          content: { 'application/json': { schema: resolver(ListScheduleRunsResponseSchema) } },
        },
        404: { description: 'No such schedule in this workspace.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'list_schedule_runs',
        description:
          'List the recent runs of a schedule (owner-scoped, newest first). Each run has its ' +
          'status (completed / failed / missed), timing, and chat session id.',
      },
    }),
    validator('param', ScheduleParamSchema),
    validator('query', ListScheduleRunsQuerySchema),
    ...workspaceScoped,
    (c) => {
      const { scheduleId } = c.req.valid('param')
      const query = c.req.valid('query')
      const runs = listScheduleRuns(c.var.db, {
        scheduleId,
        userId: c.var.user.id,
        ...(query.limit !== undefined ? { limit: query.limit } : {}),
        ...(query.cursorStartedAt !== undefined ? { cursorStartedAt: query.cursorStartedAt } : {}),
        ...(query.cursorId !== undefined ? { cursorId: query.cursorId } : {}),
      })
      return c.json(runs.map(serializeScheduleRunForResponse))
    },
  )
