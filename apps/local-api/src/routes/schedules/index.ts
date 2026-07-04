// The `schedules` HTTP surface — mounted under
// `/workspaces/:workspaceId/schedules` from `apps/local-api/src/app.ts`:
//
//   GET    /                       -> listSchedules            [x-mcp]
//   GET    /templates              -> listScheduleTemplates    [x-mcp]
//   POST   /                       -> createSchedule (cron OR one-time fireAt)
//   PATCH  /:scheduleId            -> updateSchedule
//   POST   /:scheduleId/enable     -> setScheduleEnabled(true)
//   POST   /:scheduleId/disable    -> setScheduleEnabled(false)
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
// route is exposed.
//
// DEFERRED — the source `POST /:scheduleId/fire-now` (manual run) is NOT ported
// here: it drives a headless chat turn via `composeSessionMcpServers(
// [vynelWorkspaceDescriptor], …)` + `composeSessionCapabilities`, the ③
// agent-turn MCP binding that lives at the apps/api edge and is deferred to the
// session Slice-3 app-wiring. It lands as one route + a `FireScheduleDeps`
// binding once that machinery is in KLONE.
//
// Spec: `docs/blueprints/schedules/blueprint.md §6` + coding.md §6.

import { validator } from 'hono-openapi/zod'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { workspaceScoped } from '../../handler-bundles/workspace-scoped.js'
import {
  createSchedule,
  listSchedules,
  updateSchedule,
  setScheduleEnabled,
  deleteSchedule,
  listScheduleTemplates,
  listScheduleRuns,
} from '@vynel/schedules'
import { serializeScheduleForResponse, serializeScheduleRunForResponse } from './serializers.js'
import {
  ScheduleParamSchema,
  CreateScheduleRequestSchema,
  UpdateScheduleRequestSchema,
  ListScheduleRunsQuerySchema,
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
        200: { description: 'Array of Schedule.' },
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
      responses: { 200: { description: 'Array of ScheduleTemplateDefinition.' } },
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
        201: { description: 'Schedule created.' },
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
        200: { description: 'Schedule updated.' },
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
        200: { description: 'Schedule enabled.' },
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
        200: { description: 'Schedule disabled.' },
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
        200: { description: 'Array of ScheduleRun (newest first).' },
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
