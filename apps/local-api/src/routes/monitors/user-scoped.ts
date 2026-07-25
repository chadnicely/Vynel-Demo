// The user-scoped `monitors` twin — mounted at `/monitors`:
//
//   GET  /                -> global list  [x-mcp: list_global_monitors]
//   POST /                -> arm global   [x-mcp: create_global_monitor, mutatingApproved]
//   POST /:monitorId/stop -> disarm       [x-mcp: stop_global_monitor, mutatingApproved]
//
// The GLOBAL twin of the workspace door: same three operations, different
// scope, so each needs its own tool name (the `list_plans` / `list_my_plans`
// precedent). `rootSurface: true` puts them on the global root's server.
//
// The doubling is forced, not stylistic: the generator's surfaces are MUTUALLY
// EXCLUSIVE (`nonRouting = !isRouting`), so one route cannot serve both the
// global root and the plain workspace array. There is no watchable-events tool
// on either door — the catalog is inlined into both create descriptions, since
// a root-surface catalog tool would have been unreachable from schedule fires
// and spawned sessions (see `watchable-events.ts`).
//
// Locked Hono protocol: describeRoute → validator → `...userScoped` → handler.

import { resolver, validator } from 'hono-openapi/zod'
import { createMonitor, listMonitorsForUser, stopMonitor } from '@vynel/monitors'
import { ValidationError } from '@vynel/errors'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import {
  parseReportCallerHeader,
  REPORT_CALLER_HEADER,
} from '../../sessions/report-caller-header.js'
import { serializeMonitorForResponse } from './serializers.js'
import { rejectUnwatchableTypes } from './watchable-events.js'
import { WATCH_TOOL_DESCRIPTION_BASE } from './index.js'
import {
  MonitorParamSchema,
  ListMonitorsQuerySchema,
  CreateMonitorRequestSchema,
  MonitorResponseSchema,
  ListMonitorsResponseSchema,
} from './schemas.js'

export const monitorsUserApp = factory
  .createApp()
  // GET / — the GLOBAL scope's monitors (workspaceId IS NULL only).
  .get(
    '/',
    describeRoute({
      tags: ['monitors'],
      summary: 'List the monitors armed on the global conversation.',
      'x-sdk-name': 'monitorsUser.list',
      responses: {
        200: {
          description: 'Array of Monitor.',
          content: { 'application/json': { schema: resolver(ListMonitorsResponseSchema) } },
        },
      },
      'x-mcp': {
        exposed: true,
        name: 'list_global_monitors',
        rootSurface: true,
        description:
          'List the watches armed on THIS global conversation — what each is waiting for, ' +
          'whether it is still armed, how many times it has fired, and when it expires. Shows ' +
          "global monitors only; a workspace's own watches are listed by list_monitors there. " +
          'Check this before arming another so you do not duplicate a watch. Read-only.',
      },
    }),
    validator('query', ListMonitorsQuerySchema),
    ...userScoped,
    (c) => {
      const { status } = c.req.valid('query')
      const monitors = listMonitorsForUser(c.var.db, {
        userId: c.var.user.id,
        ...(status !== undefined ? { status } : {}),
      })
      return c.json(monitors.map(serializeMonitorForResponse))
    },
  )
  // POST / — arm a watch on the global conversation.
  .post(
    '/',
    describeRoute({
      tags: ['monitors'],
      summary: 'Arm a watch that wakes the global conversation.',
      'x-sdk-name': 'monitorsUser.create',
      responses: {
        201: {
          description: 'Monitor armed.',
          content: { 'application/json': { schema: resolver(MonitorResponseSchema) } },
        },
        400: { description: 'Validation error, or an event type that is not watchable.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'create_global_monitor',
        rootSurface: true,
        mutatingApproved: true,
        description: WATCH_TOOL_DESCRIPTION_BASE,
      },
    }),
    validator('json', CreateMonitorRequestSchema),
    ...userScoped,
    (c) => {
      const body = c.req.valid('json')
      const unwatchable = rejectUnwatchableTypes(body.eventTypes)
      if (unwatchable.length > 0) {
        throw new ValidationError(
          `Not watchable: ${unwatchable.join(', ')}. See the create_monitor tool description for the watchable types.`,
        )
      }

      // Ambient ownership. A spawned session reaches this door through its own
      // dispatcher, so it owns the monitor even though the scope is global —
      // its wake goes to ITS conversation, not the root's.
      const caller = parseReportCallerHeader(c.req.header(REPORT_CALLER_HEADER))
      const owner =
        caller?.kind === 'spawned-session'
          ? { ownerKind: 'spawned-session' as const, ownerSessionId: caller.targetPrimarySessionId }
          : { ownerKind: 'global-root' as const }

      const monitor = createMonitor(
        c.var.db,
        {
          userId: c.var.user.id,
          workspaceId: null,
          ...owner,
          description: body.description,
          eventTypes: body.eventTypes,
          ...(body.payloadFilter !== undefined ? { payloadFilter: body.payloadFilter } : {}),
          ...(body.mode !== undefined ? { mode: body.mode } : {}),
          ...(body.expiresInMs !== undefined ? { expiresInMs: body.expiresInMs } : {}),
        },
        { logger: c.var.logger },
      )
      return c.json(serializeMonitorForResponse(monitor), 201)
    },
  )
  // POST /:monitorId/stop — the ONE disarm door, reachable from both surfaces.
  .post(
    '/:monitorId/stop',
    describeRoute({
      tags: ['monitors'],
      summary: 'Stop an armed monitor.',
      'x-sdk-name': 'monitorsUser.stop',
      responses: {
        200: {
          description: 'Monitor stopped.',
          content: { 'application/json': { schema: resolver(MonitorResponseSchema) } },
        },
        400: { description: 'The monitor is already fired, stopped, or expired.' },
        404: { description: 'Monitor not found, or not owned.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'stop_global_monitor',
        rootSurface: true,
        mutatingApproved: true,
        description:
          'Disarm a watch you armed — use it once you no longer care about the thing you were ' +
          'waiting for, so it does not wake you later. Takes the monitor id from create_monitor ' +
          '/ create_global_monitor or either list. Works for global and workspace monitors ' +
          'alike. Only an armed monitor can be stopped.',
      },
    }),
    validator('param', MonitorParamSchema),
    ...userScoped,
    (c) => {
      const { monitorId } = c.req.valid('param')
      const monitor = stopMonitor(
        c.var.db,
        { userId: c.var.user.id, monitorId },
        { logger: c.var.logger },
      )
      return c.json(serializeMonitorForResponse(monitor))
    },
  )
