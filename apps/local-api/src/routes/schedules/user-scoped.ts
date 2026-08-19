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
//                                                         [x-mcp: create_my_schedule]
//   PATCH  /:scheduleId         -> updateSchedule         [x-mcp: update_my_schedule]
//   POST   /:scheduleId/enable  -> setScheduleEnabled(true)   [x-mcp: enable_my_schedule]
//   POST   /:scheduleId/disable -> setScheduleEnabled(false)  [x-mcp: disable_my_schedule]
//   POST   /:scheduleId/fire-now -> manualFireSchedule (drives a headless turn)
//   DELETE /:scheduleId         -> deleteSchedule (hard-delete, cascades)
//   GET    /:scheduleId/runs    -> listScheduleRuns
//
// `/templates` is intentionally omitted — the template catalog is
// workspace-independent and already exposed by `schedules.listTemplates`.
//
// Locked Hono protocol: describeRoute -> validator -> `...userScoped` -> handler
// on `factory.createApp()`; handlers THROW typed VynelError subclasses (the
// app.ts onError maps them). MCP exposure (Kafi 2026-08-20, revising D14):
// `list_my_schedules` PLUS the create/update/enable/disable mutations — all
// rootSurface (the GLOBAL surfaces' schedule door; the list additionally keeps
// its workspace membership via workspaceSurface). The mutations ride the
// ask-approval tier (card in ask mode, run in auto). Still NEVER exposed:
// fire-now (it DRIVES a turn, never an agent tool) and DELETE (destruction
// stays the user's). `fire-now` authorizes by userId (the tenant boundary) via
// `manualFireSchedule` — a global (null-workspace) schedule is authorized the
// same way. Serializers + the param/update/runs schemas are REUSED from the
// workspace-scoped surface.

import { resolver, validator } from 'hono-openapi/zod'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import { buildScheduleFireDeps } from '../../sessions/build-schedule-fire-deps.js'
import { buildEnabledFeatureKeysReader } from '../../sessions/enabled-feature-keys.js'
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
  ScheduleResponseSchema,
  ListSchedulesResponseSchema,
  ScheduleRunResponseSchema,
  ListScheduleRunsResponseSchema,
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
      responses: {
        200: {
          description: 'Array of Schedule.',
          content: { 'application/json': { schema: resolver(ListSchedulesResponseSchema) } },
        },
      },
      'x-mcp': {
        exposed: true,
        name: 'list_my_schedules',
        // rootSurface: the GLOBAL surfaces list schedules through this door;
        // workspaceSurface keeps its existing workspace-family membership.
        rootSurface: true,
        workspaceSurface: true,
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
        201: {
          description: 'Schedule created.',
          content: { 'application/json': { schema: resolver(ScheduleResponseSchema) } },
        },
        400: { description: 'Invalid cron, missing channel, past fireAt, or workspaceId missing for a workspace scope.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'create_my_schedule',
        mutatingApproved: true,
        askApproval: true,
        rootSurface: true,
        // Omitting workspaceId here means scope 'global', never "my workspace"
        // — the ambient stamp would silently rescope the create.
        ambientWorkspace: false,
        description:
          "Create a scheduled routine for the user — scope 'global' creates a global schedule " +
          "(no workspace), scope 'workspace' plus that workspace's workspaceId creates one for " +
          'a named workspace. Use this whenever the user asks to be reminded, or wants ' +
          "something done on a schedule ('remind me…', 'every morning…', 'in 20 minutes…'). " +
          'Creates a real schedule that fires even after restarts. NEVER simulate a reminder ' +
          "with sleep/timers/background processes. templateKind 'reminder' delivers " +
          "promptTemplate VERBATIM at fire time (put the user's exact reminder text in it — no " +
          "AI turn); use 'custom' with a promptTemplate when the fire should DO work (an AI " +
          'turn runs it). Recurring: set cronExpression (5-field cron, evaluated in `timezone` ' +
          "— defaults to the user's profile timezone). One-time ('at 5pm', 'in 20 minutes'): " +
          'set fireAt instead (ISO-8601 with offset, must be in the future; it wins over cron).',
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
        200: {
          description: 'Schedule updated.',
          content: { 'application/json': { schema: resolver(ScheduleResponseSchema) } },
        },
        400: { description: 'Invalid cron or missing channel.' },
        404: { description: 'No such schedule owned by this user.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'update_my_schedule',
        mutatingApproved: true,
        askApproval: true,
        rootSurface: true,
        description:
          'Update any schedule the user owns (global or workspace; find ids via ' +
          'list_my_schedules) — its displayName, promptTemplate (the reminder text or work ' +
          'prompt), cronExpression/timezone (the next fire recomputes), destination, or ' +
          'isEnabled. Only the fields you pass change.',
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
        200: {
          description: 'Schedule enabled.',
          content: { 'application/json': { schema: resolver(ScheduleResponseSchema) } },
        },
        404: { description: 'No such schedule owned by this user.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'enable_my_schedule',
        mutatingApproved: true,
        askApproval: true,
        rootSurface: true,
        description:
          'Turn any schedule the user owns (global or workspace) back on so it fires again at ' +
          'its next scheduled time.',
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
        200: {
          description: 'Schedule disabled.',
          content: { 'application/json': { schema: resolver(ScheduleResponseSchema) } },
        },
        404: { description: 'No such schedule owned by this user.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'disable_my_schedule',
        mutatingApproved: true,
        askApproval: true,
        rootSurface: true,
        description:
          'Turn any schedule the user owns (global or workspace) off — it stays listed but ' +
          'stops firing until re-enabled. Use this to pause a routine, never to delete it.',
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
        202: {
          description: 'Run started.',
          content: { 'application/json': { schema: resolver(ScheduleRunResponseSchema) } },
        },
        404: { description: 'No such schedule owned by this user.' },
        409: { description: 'The schedule is paused.' },
      },
    }),
    validator('param', ScheduleParamSchema),
    ...userScoped,
    async (c) => {
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
        200: {
          description: 'Array of ScheduleRun (newest first).',
          content: { 'application/json': { schema: resolver(ListScheduleRunsResponseSchema) } },
        },
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
