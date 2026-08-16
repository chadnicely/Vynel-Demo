// The `processes` HTTP surface — mounted at `/processes` (user-scoped):
//
//   POST /                     -> run_background_process   [mutating, ALWAYS cards — shell]
//   GET  /                     -> list_background_processes
//   GET  /:processId           -> get_background_process
//   POST /:processId/kill      -> kill_background_process  [mutating, uncarded — own process]
//
// ONE door on every surface (`rootSurface` + `workspaceSurface`, the
// send_message precedent): a background process is the same act from the
// global root, a workspace turn, a schedule fire, or a spawned session — two
// differently-named tools for it would be the misroute trap the comms verb
// eliminated. Scope is ambient: the workspace surface stamps `workspaceId`,
// and the command runs at that scope's ground.
//
// OWNERSHIP IS AMBIENT, NEVER AN INPUT (the monitors rule): who gets woken on
// completion is resolved from the caller header + the scope — the model never
// names a session. The wake itself is a MONITOR the run handler auto-arms on
// `process.completed` / `process.failed` filtered to this process — app-tier
// composition of two leaves (processes cannot import monitors; siblings).
//
// CARDING: `run_background_process` executes arbitrary shell — it sits in the
// vynel descriptors' `mutatingToolNames`, so it cards in EVERY mode, exactly
// like the Bash floor it is equivalent to. `kill` only ends a process the
// agent itself started (the stop_monitor rule: own bookkeeping, uncarded).

import { resolver, validator } from 'hono-openapi/zod'
import {
  startBackgroundProcess,
  killBackgroundProcess,
  listBackgroundProcesses,
  getBackgroundProcess,
  PROCESS_COMPLETED,
  PROCESS_FAILED,
  type BackgroundProcessOwnerKind,
} from '@vynel/processes'
import { createMonitor, MONITOR_MAX_TTL_MS } from '@vynel/monitors'
import { getWorkspaceById } from '@vynel/workspaces'
import { findSpawnedSessionById } from '@vynel/session/spawned'
import { NotFoundError } from '@vynel/errors'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import {
  parseReportCallerHeader,
  REPORT_CALLER_HEADER,
} from '../../sessions/report-caller-header.js'
import { resolveSpawnedSessionRunCwd } from '../../sessions/spawned-session-ground.js'
import { resolveGlobalRootWorkspacePath } from '../../sessions/global-root-workspace.js'
import {
  RunProcessRequestSchema,
  RunProcessResponseSchema,
  ProcessParamSchema,
  ListProcessesQuerySchema,
  ProcessResponseSchema,
  ListProcessesResponseSchema,
  serializeProcessForResponse,
} from './schemas.js'

// The wake must outlive the process by enough slack for the settle + the
// monitor tick to land; capped at the monitors ceiling.
const WAKE_MONITOR_SLACK_MS = 10 * 60 * 1000

export const processesApp = factory
  .createApp()
  // POST / — run a command in the background, owned by THIS turn's conversation.
  .post(
    '/',
    describeRoute({
      tags: ['processes'],
      summary: 'Run a shell command in the background; the exit wakes this conversation.',
      'x-sdk-name': 'processes.run',
      responses: {
        201: {
          description: 'The process, running, with the auto-armed completion watch.',
          content: { 'application/json': { schema: resolver(RunProcessResponseSchema) } },
        },
        400: { description: 'Validation error, or the running-process cap.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'run_background_process',
        mutatingApproved: true,
        rootSurface: true,
        workspaceSurface: true,
        description:
          'Run a shell command in the BACKGROUND — it keeps running after this turn ends, and ' +
          'when it exits you are WOKEN with the exit code and the output tail (a completion ' +
          'watch is armed for you automatically). Use it for long work you should not sit ' +
          'through: test suites, builds, installs. The command runs at your scope’s folder ' +
          '(the workspace’s folder, or the global ground). `timeoutMs` is the runtime ' +
          'ceiling — the process is killed past it (default 30 minutes, max 24 hours). ' +
          'Returns IMMEDIATELY with { processId, status: "running" }; check on it with ' +
          'list_background_processes / get_background_process, end it early with ' +
          'kill_background_process. NOT for quick commands (use Bash — you get the answer in ' +
          'the same turn) and NOT for work another session should own (send_message a task).',
      },
    }),
    validator('json', RunProcessRequestSchema),
    ...userScoped,
    async (c) => {
      const body = c.req.valid('json')

      // Ambient ownership + ground: a spawned session runs in ITS cwd and is
      // woken itself; a workspace scope runs at the workspace folder and wakes
      // the workspace's conversation; bare global runs at the global ground.
      const caller = parseReportCallerHeader(c.req.header(REPORT_CALLER_HEADER))
      let ownerKind: BackgroundProcessOwnerKind
      let ownerSessionId: string | null = null
      let cwdPath: string
      let scopeWorkspaceId: string | null
      if (caller?.kind === 'spawned-session') {
        const spawned = findSpawnedSessionById(c.var.db, {
          userId: c.var.user.id,
          primarySessionId: caller.targetPrimarySessionId,
        })
        if (spawned === null) throw new NotFoundError('session', caller.targetPrimarySessionId)
        ownerKind = 'spawned-session'
        ownerSessionId = caller.targetPrimarySessionId
        cwdPath = resolveSpawnedSessionRunCwd(c.var.db, spawned)
        scopeWorkspaceId = spawned.workspaceId
      } else if (body.workspaceId !== undefined) {
        // Ownership-checked (NotFoundError when unknown or not owned).
        const workspace = await getWorkspaceById(c.var.db, body.workspaceId, c.var.user.id)
        ownerKind = 'workspace-primary'
        cwdPath = workspace.path
        scopeWorkspaceId = workspace.id
      } else {
        ownerKind = 'global-root'
        cwdPath = resolveGlobalRootWorkspacePath()
        scopeWorkspaceId = null
      }

      const row = startBackgroundProcess(
        c.var.db,
        {
          userId: c.var.user.id,
          workspaceId: scopeWorkspaceId,
          ownerKind,
          ownerSessionId,
          command: body.command,
          cwdPath,
          ...(body.timeoutMs !== undefined ? { timeoutMs: body.timeoutMs } : {}),
        },
        { runner: c.var.processRunner, logger: c.var.logger },
      )

      // The completion wake — best-effort: an arming failure must not kill a
      // process that is already running; the caller can still poll.
      let monitorId: string | null = null
      try {
        const monitor = createMonitor(
          c.var.db,
          {
            userId: c.var.user.id,
            workspaceId: scopeWorkspaceId,
            ownerKind,
            ...(ownerSessionId !== null ? { ownerSessionId } : {}),
            description: `background process: ${row.command.slice(0, 140)}`,
            eventTypes: [PROCESS_COMPLETED, PROCESS_FAILED],
            payloadFilter: { processId: row.id },
            mode: 'once',
            expiresInMs: Math.min(row.timeoutMs + WAKE_MONITOR_SLACK_MS, MONITOR_MAX_TTL_MS),
          },
          { logger: c.var.logger },
        )
        monitorId = monitor.id
      } catch (err) {
        c.var.logger.warn(
          { err, processId: row.id },
          'processes: completion watch failed to arm — the process still runs',
        )
      }

      return c.json(
        { ...serializeProcessForResponse(row, c.var.processRunner.tailOf(row.id)), monitorId },
        201,
      )
    },
  )
  // GET / — this scope's processes.
  .get(
    '/',
    describeRoute({
      tags: ['processes'],
      summary: 'List the background processes of the active scope, newest first.',
      'x-sdk-name': 'processes.list',
      responses: {
        200: {
          description: 'Array of processes with status and output tails.',
          content: { 'application/json': { schema: resolver(ListProcessesResponseSchema) } },
        },
      },
      'x-mcp': {
        exposed: true,
        name: 'list_background_processes',
        rootSurface: true,
        workspaceSurface: true,
        description:
          'List the background processes of this scope, newest first — each with its ' +
          'processId, status (running / succeeded / failed), exit code, and output tail. ' +
          'Check this instead of assuming a command finished. Optional `status` filters. ' +
          'Read-only.',
      },
    }),
    validator('query', ListProcessesQuerySchema),
    ...userScoped,
    async (c) => {
      const { status, workspaceId } = c.req.valid('query')
      // Scope rides the ambient-stamped param (the generator stamps
      // `scope.workspaceId` on every workspace-surface turn, spawned
      // groundings included) — ownership-checked when present; absent = the
      // GLOBAL scope's rows, never "all of the user's".
      if (workspaceId !== undefined) {
        await getWorkspaceById(c.var.db, workspaceId, c.var.user.id)
      }
      const rows = listBackgroundProcesses(c.var.db, {
        userId: c.var.user.id,
        workspaceId: workspaceId ?? null,
        ...(status !== undefined ? { status } : {}),
      })
      return c.json(
        rows.map((row) => serializeProcessForResponse(row, c.var.processRunner.tailOf(row.id))),
      )
    },
  )
  // GET /:processId — one process, live tail included.
  .get(
    '/:processId',
    describeRoute({
      tags: ['processes'],
      summary: 'Get one background process, with its full output tail.',
      'x-sdk-name': 'processes.get',
      responses: {
        200: {
          description: 'The process.',
          content: { 'application/json': { schema: resolver(ProcessResponseSchema) } },
        },
        404: { description: 'Unknown process, or not owned.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'get_background_process',
        rootSurface: true,
        workspaceSurface: true,
        description:
          'Get one background process by its processId — status, exit code, and the output ' +
          'tail (live while it runs, final once it settled). Use it when you were woken with ' +
          'a result and need more of the output, or to check on a run mid-flight. Read-only.',
      },
    }),
    validator('param', ProcessParamSchema),
    ...userScoped,
    (c) => {
      const { processId } = c.req.valid('param')
      const row = getBackgroundProcess(c.var.db, { userId: c.var.user.id, processId })
      // Unknown and not-owned are the SAME 404 (the query returns null for both).
      if (row === null) throw new NotFoundError('background process', processId)
      return c.json(serializeProcessForResponse(row, c.var.processRunner.tailOf(row.id)))
    },
  )
  // POST /:processId/kill — end one of your own processes early.
  .post(
    '/:processId/kill',
    describeRoute({
      tags: ['processes'],
      summary: 'Kill a running background process.',
      'x-sdk-name': 'processes.kill',
      responses: {
        200: {
          description: 'The process (settling as failed/killed).',
          content: { 'application/json': { schema: resolver(ProcessResponseSchema) } },
        },
        400: { description: 'The process already finished.' },
        404: { description: 'Unknown process, or not owned.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'kill_background_process',
        mutatingApproved: true,
        rootSurface: true,
        workspaceSurface: true,
        description:
          'End a running background process early — use it when you no longer need the ' +
          'result. Takes the processId from run_background_process or ' +
          'list_background_processes; the completion watch still fires, reporting it killed.',
      },
    }),
    validator('param', ProcessParamSchema),
    ...userScoped,
    (c) => {
      const { processId } = c.req.valid('param')
      const row = killBackgroundProcess(
        c.var.db,
        { userId: c.var.user.id, processId },
        { runner: c.var.processRunner, logger: c.var.logger },
      )
      return c.json(serializeProcessForResponse(row, c.var.processRunner.tailOf(row.id)))
    },
  )
