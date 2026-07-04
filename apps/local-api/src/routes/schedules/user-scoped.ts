// The USER-scoped `schedules` HTTP surface — mounted at `/schedules` (NO
// workspace prefix) from `apps/local-api/src/app.ts`, alongside the untouched
// workspace-scoped twin (`/workspaces/:workspaceId/schedules`). These routes
// span BOTH scopes: a user's GLOBAL (null-workspace) schedules AND every
// workspace schedule they own. The existing id-ops (update/enable/disable/
// delete/listRuns) already authorize by userId — the tenant boundary — and
// never touch workspaceId, so they serve a global schedule directly; the routes
// delegate with `userId: c.var.user.id`. Not-found and not-owned both return an
// identical 404 (no enumeration leak).
//
//   GET    /                    -> listSchedulesForUser   [x-mcp: list_my_schedules]
//   POST   /                    -> createSchedule (scope: global|workspace; cron OR one-time fireAt)
//   PATCH  /:scheduleId         -> updateSchedule
//   POST   /:scheduleId/enable  -> setScheduleEnabled(true)
//   POST   /:scheduleId/disable -> setScheduleEnabled(false)
//   POST   /:scheduleId/fire-now -> manualFireSchedule (drives a headless turn)
//   DELETE /:scheduleId         -> deleteSchedule (hard-delete, cascades)
//   GET    /:scheduleId/runs    -> listScheduleRuns
//
// `/templates` is intentionally omitted — the template catalog is
// workspace-independent and already exposed by `schedules.listTemplates`.
//
// Locked Hono protocol: describeRoute -> validator -> `...userScoped` -> handler
// on `factory.createApp()`; handlers THROW typed VynelError subclasses (the
// app.ts onError maps them). Only the safe-read `GET /` is x-mcp exposed
// (list_my_schedules) — no mutating route is exposed (fire-now DRIVES a turn, so
// it is never an agent tool). `fire-now` authorizes by userId (the tenant
// boundary) via `manualFireSchedule` — a global (null-workspace) schedule is
// authorized the same way. Serializers + the param/update/runs schemas are
// REUSED from the workspace-scoped surface.

import { validator } from 'hono-openapi/zod'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import { buildScheduleFireDeps } from '../../sessions/build-schedule-fire-deps.js'
import {
  createSchedule,
  listSchedulesForUser,
  updateSchedule,
  setScheduleEnabled,
  deleteSchedule,
  listScheduleRuns,
  manualFireSchedule,
} from '@vynel/schedules'
import { serializeScheduleForResponse, serializeScheduleRunForResponse } from './serializers.js'
import {
  ScheduleParamSchema,
  CreateScheduleForUserRequestSchema,
  UpdateScheduleRequestSchema,
  ListScheduleRunsQuerySchema,
} from './schemas.js'

export const schedulesUserApp = factory
  .createApp()
  // GET / — every schedule the user owns, both scopes.
  .get(
    '/',
    describeRoute({
      tags: ['schedules'],
      summary: 'List every schedule the user owns — global + workspace.',
      'x-sdk-name': 'schedulesUser.list',
      responses: { 200: { description: 'Array of Schedule.' } },
      'x-mcp': {
        exposed: true,
        name: 'list_my_schedules',
        description:
          'List every scheduled routine the user owns — both global (no workspace) and ' +
          'workspace-scoped. Each has its cron expression (or one-time fire time), destination, ' +
          'enabled flag, and next fire time. Read-only.',
      },
    }),
    ...userScoped,
    (c) => {
      const schedules = listSchedulesForUser(c.var.db, { userId: c.var.user.id })
      return c.json(schedules.map(serializeScheduleForResponse))
    },
  )
  // POST / — create a schedule; scope picks global (null workspace) vs a workspace.
  .post(
    '/',
    describeRoute({
      tags: ['schedules'],
      summary: 'Create a global or workspace schedule (recurring cron OR one-time fireAt).',
      'x-sdk-name': 'schedulesUser.create',
      responses: {
        201: { description: 'Schedule created.' },
        400: { description: 'Invalid cron, missing channel, past fireAt, or workspaceId missing for a workspace scope.' },
      },
    }),
    validator('json', CreateScheduleForUserRequestSchema),
    ...userScoped,
    (c) => {
      const body = c.req.valid('json')
      const workspaceId = body.scope === 'global' ? null : body.workspaceId
      const schedule = createSchedule(
        c.var.db,
        {
          userId: c.var.user.id,
          workspaceId,
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
      summary: 'Update a schedule the user owns.',
      'x-sdk-name': 'schedulesUser.update',
      responses: {
        200: { description: 'Schedule updated.' },
        400: { description: 'Invalid cron or missing channel.' },
        404: { description: 'No such schedule owned by this user.' },
      },
    }),
    validator('param', ScheduleParamSchema),
    validator('json', UpdateScheduleRequestSchema),
    ...userScoped,
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
      summary: 'Enable a schedule the user owns.',
      'x-sdk-name': 'schedulesUser.enable',
      responses: {
        200: { description: 'Schedule enabled.' },
        404: { description: 'No such schedule owned by this user.' },
      },
    }),
    validator('param', ScheduleParamSchema),
    ...userScoped,
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
      summary: 'Disable a schedule the user owns.',
      'x-sdk-name': 'schedulesUser.disable',
      responses: {
        200: { description: 'Schedule disabled.' },
        404: { description: 'No such schedule owned by this user.' },
      },
    }),
    validator('param', ScheduleParamSchema),
    ...userScoped,
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
  // Authorized by userId (manualFireSchedule) so it serves a global schedule too.
  .post(
    '/:scheduleId/fire-now',
    describeRoute({
      tags: ['schedules'],
      summary: 'Fire a schedule the user owns immediately (a manual run; does not affect the next scheduled fire).',
      'x-sdk-name': 'schedulesUser.fireNow',
      responses: {
        202: { description: 'Run started.' },
        404: { description: 'No such schedule owned by this user.' },
        409: { description: 'The schedule is paused.' },
      },
    }),
    validator('param', ScheduleParamSchema),
    ...userScoped,
    async (c) => {
      const fireDeps =
        c.var.scheduleFireDeps ??
        (await buildScheduleFireDeps(c.var.db, c.var.appRequest, c.var.logger))
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
      summary: 'Delete a schedule the user owns (hard delete; cascades to its run history).',
      'x-sdk-name': 'schedulesUser.delete',
      responses: {
        204: { description: 'Schedule deleted.' },
        404: { description: 'No such schedule owned by this user.' },
      },
    }),
    validator('param', ScheduleParamSchema),
    ...userScoped,
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
      summary: "List a schedule's run history (owner-scoped, newest first, keyset-paginated).",
      'x-sdk-name': 'schedulesUser.listRuns',
      responses: {
        200: { description: 'Array of ScheduleRun (newest first).' },
        404: { description: 'No such schedule owned by this user.' },
      },
    }),
    validator('param', ScheduleParamSchema),
    validator('query', ListScheduleRunsQuerySchema),
    ...userScoped,
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
