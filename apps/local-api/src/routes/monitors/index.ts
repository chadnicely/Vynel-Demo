// The workspace-scoped `monitors` HTTP surface — mounted under
// `/workspaces/:workspaceId/monitors` from `apps/local-api/src/app.ts`:
//
//   GET    /                 -> listMonitors  [x-mcp: list_monitors]
//   POST   /                 -> createMonitor [x-mcp: create_monitor, mutatingApproved]
//   POST   /:monitorId/stop  -> stopMonitor   [x-mcp: stop_monitor, mutatingApproved]
//
// Every op is doubled on the user-scoped twin under a global-flavored name
// (`create_global_monitor`, …). Not redundancy for its own sake: the
// generator's surfaces are MUTUALLY EXCLUSIVE (`nonRouting = !isRouting`), so
// one route cannot serve both the global root and the plain workspace array
// that schedule fires and spawned sessions read. A turn that can arm a monitor
// must be able to stop it.
//
// THIS IS THE AGENT'S SURFACE, and monitors are the agent's own working state —
// a standing interest in something happening. It arms a watch, keeps working,
// and when a matching event lands the OWNING session is woken with it.
//
// OWNERSHIP IS AMBIENT, NEVER AN INPUT. Which session gets woken is resolved
// server-side from the caller header (`report-caller-header.ts`) plus the door
// that was called — the model never names a session. That is the same fork
// `report_to_requester` settled: a model-visible session id could be mis-set
// and would wake the wrong conversation. Server-stamped, it cannot lie.
//
// Writes are UNCARDED (mutatingApproved, like task/plan writes): a monitor is
// Claude's own bookkeeping — nothing outward-facing, nothing destructive, and
// stopping one only disarms a watch it armed itself. Per Chad's 2026-07-26
// rule, approval is for deletes and destructive actions.
//
// Locked Hono protocol: describeRoute → validator → `...workspaceScoped` →
// handler on `factory.createApp()`; handlers THROW typed VynelError subclasses.

import { resolver, validator } from 'hono-openapi/zod'
import { createMonitor, listMonitors, stopMonitor } from '@vynel/monitors'
import { ValidationError } from '@vynel/errors'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { workspaceScoped } from '../../handler-bundles/workspace-scoped.js'
import {
  parseReportCallerHeader,
  REPORT_CALLER_HEADER,
} from '../../sessions/report-caller-header.js'
import { serializeMonitorForResponse } from './serializers.js'
import {
  rejectUnwatchableTypes,
  WATCHABLE_EVENT_TYPES_FOR_PROMPT,
} from './watchable-events.js'
import {
  MonitorParamSchema,
  ListMonitorsQuerySchema,
  CreateMonitorRequestSchema,
  MonitorResponseSchema,
  ListMonitorsResponseSchema,
} from './schemas.js'

// The one home for the arming tool's guidance — the user-scoped twin's
// `create_global_monitor` says the same thing about a different scope, and the
// two descriptions drifting apart would teach the model two different tools.
export const WATCH_TOOL_DESCRIPTION_BASE =
  'Arm a watch that wakes THIS conversation when something happens, so you can start ' +
  'something and get on with other work instead of polling. `description` says what you are ' +
  'waiting for in plain language — it is shown to you when the watch fires. `payloadFilter` ' +
  'narrows to one thing ({"appId": "..."}) using the filterable fields listed below. `mode` is ' +
  '"once" (the default — wake me the first time) or "recurring" (wake me every time). ' +
  '`expiresInMs` sets the deadline; it defaults to 24 hours and every monitor has one. Returns ' +
  'the monitor id for stopping it. NOTE: the wake starts a NEW turn on this conversation — it ' +
  'will not interrupt one already running.\n\n`eventTypes` must come from this list:\n' +
  WATCHABLE_EVENT_TYPES_FOR_PROMPT

export const monitorsApp = factory
  .createApp()
  // GET / — the workspace's monitors.
  .get(
    '/',
    describeRoute({
      tags: ['monitors'],
      summary: 'List the monitors armed on the active workspace.',
      'x-sdk-name': 'monitors.list',
      responses: {
        200: {
          description: 'Array of Monitor.',
          content: { 'application/json': { schema: resolver(ListMonitorsResponseSchema) } },
        },
        404: { description: 'Workspace not found.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'list_monitors',
        description:
          'List the watches armed on this workspace — what each is waiting for, whether it is ' +
          'still armed, how many times it has fired, and when it expires. Check this before ' +
          'arming another one so you do not duplicate a watch, and to find the id to stop. ' +
          'Optional `status` filters to armed / fired / stopped / expired. Read-only.',
      },
    }),
    validator('query', ListMonitorsQuerySchema),
    ...workspaceScoped,
    (c) => {
      const { status } = c.req.valid('query')
      const monitors = listMonitors(c.var.db, {
        userId: c.var.user.id,
        workspaceId: c.var.workspace!.id,
        ...(status !== undefined ? { status } : {}),
      })
      return c.json(monitors.map(serializeMonitorForResponse))
    },
  )
  // POST / — arm a watch owned by THIS turn's conversation.
  .post(
    '/',
    describeRoute({
      tags: ['monitors'],
      summary: 'Arm a watch that wakes this conversation when a matching event lands.',
      'x-sdk-name': 'monitors.create',
      responses: {
        201: {
          description: 'Monitor armed.',
          content: { 'application/json': { schema: resolver(MonitorResponseSchema) } },
        },
        400: { description: 'Validation error, or an event type that is not watchable.' },
        404: { description: 'Workspace not found.' },
      },
      'x-mcp': { exposed: true, name: 'create_monitor', mutatingApproved: true, description: WATCH_TOOL_DESCRIPTION_BASE },
    }),
    validator('json', CreateMonitorRequestSchema),
    ...workspaceScoped,
    (c) => {
      const body = c.req.valid('json')
      // Reject a typo'd type at the boundary — arming an unmatchable watch
      // looks identical to one that is still waiting, which is the worst
      // failure this feature can have.
      const unwatchable = rejectUnwatchableTypes(body.eventTypes)
      if (unwatchable.length > 0) {
        throw new ValidationError(
          `Not watchable: ${unwatchable.join(', ')}. See the create_monitor tool description for the watchable types.`,
        )
      }

      // Ambient ownership: a spawned session reports as itself, anything else
      // on this door is the workspace's own conversation.
      const caller = parseReportCallerHeader(c.req.header(REPORT_CALLER_HEADER))
      const owner =
        caller?.kind === 'spawned-session'
          ? { ownerKind: 'spawned-session' as const, ownerSessionId: caller.targetPrimarySessionId }
          : { ownerKind: 'workspace-primary' as const }

      const monitor = createMonitor(
        c.var.db,
        {
          userId: c.var.user.id,
          workspaceId: c.var.workspace!.id,
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
  // POST /:monitorId/stop — the workspace surface's disarm door. Its twin on
  // the root door is `stop_global_monitor`; both call the same tenant-checked
  // core op, and each door needs its own because the generator's surfaces are
  // mutually exclusive (a root-surface tool never reaches a schedule fire or a
  // spawned session, which can arm monitors and so must be able to stop them).
  .post(
    '/:monitorId/stop',
    describeRoute({
      tags: ['monitors'],
      summary: 'Stop an armed monitor.',
      'x-sdk-name': 'monitors.stop',
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
        name: 'stop_monitor',
        mutatingApproved: true,
        description:
          'Disarm a watch you armed — use it once you no longer care about the thing you were ' +
          'waiting for, so it does not wake you later. Takes the monitor id from create_monitor ' +
          'or list_monitors. Only an armed monitor can be stopped.',
      },
    }),
    validator('param', MonitorParamSchema),
    ...workspaceScoped,
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
