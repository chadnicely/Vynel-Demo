// The `workspace-apps` HTTP surface — mounted under
// `/workspaces/:workspaceId/apps` from `apps/local-api/src/app.ts`, behind
// `featureGate('apps')` (pro tier):
//
//   GET    /               -> listApps + live supervisor status  [x-mcp]
//   POST   /               -> registerApp                        [x-mcp, mutatingApproved]
//   PATCH  /:appId         -> updateApp                          [x-mcp, mutatingApproved]
//   DELETE /:appId         -> stop (if running) + removeApp
//   POST   /:appId/start   -> supervisor.start + app.started     [x-mcp, mutatingApproved]
//   POST   /:appId/stop    -> supervisor.stop  + app.stopped     [x-mcp, mutatingApproved]
//   GET    /:appId/logs    -> ring-buffer tail                   [x-mcp]
//   GET    /:appId/env     -> readAppEnvFile (parse the file)    [user-only]
//   PUT    /:appId/env     -> writeAppEnvFile (full desired set) [user-only]
//
// The env editor is deliberately NOT an MCP tool: env values are secrets, and
// they must never transit chat as tool results — Claude edits files directly
// when it needs to. The row's `envFileRelative` (settable via add_app /
// update_app) points at the file; the editor parses and rewrites THAT file
// line-preservingly (comments survive), so the file the app actually loads
// stays the single source of truth.
//
// NO APPROVAL CARDS anywhere (Chad, docs/module-notes/apps.md): running your
// own dev app is low-stakes + reversible; the safety story is visibility
// (status, logs, the section) + the supervisor's cwd containment. Delete is
// not an agent tool — removal is the user's call (the tasks precedent).
//
// Locked Hono protocol: describeRoute → validator → `...workspaceScoped` →
// handler; handlers THROW typed VynelError subclasses. The supervisor's
// taxonomy-free errors are mapped HERE (already-running → Conflict,
// cwd-escape → Validation) — the one edge where routes translate.

import { resolver, validator } from 'hono-openapi/zod'
import { ConflictError, ValidationError } from '@vynel/errors'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { workspaceScoped } from '../../handler-bundles/workspace-scoped.js'
import {
  getAppOrThrow,
  listApps,
  publishAppRuntimeEvent,
  readAppEnvFile,
  registerApp,
  removeApp,
  updateApp,
  writeAppEnvFile,
} from '@vynel/apps'
import { serializeAppForResponse } from './serializers.js'
import {
  AppParamSchema,
  AppLogsQuerySchema,
  RegisterAppRequestSchema,
  UpdateAppRequestSchema,
  UpdateAppEnvRequestSchema,
  WorkspaceAppResponseSchema,
  ListWorkspaceAppsResponseSchema,
  AppLogsResponseSchema,
  AppEnvResponseSchema,
} from './schemas.js'

export const workspaceAppsApp = factory
  .createApp()
  // GET / — the registered apps + each one's live runtime snapshot.
  .get(
    '/',
    describeRoute({
      tags: ['apps'],
      summary: "List the workspace's apps with live run status.",
      'x-sdk-name': 'workspaceApps.list',
      responses: {
        200: {
          description: 'Array of WorkspaceApp (runtime merged).',
          content: { 'application/json': { schema: resolver(ListWorkspaceAppsResponseSchema) } },
        },
        404: { description: 'Workspace not found.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'list_apps',
        description:
          "List the workspace's registered runnable apps (dev servers, builds) with live " +
          'status: running / exited / crashed (with exit code), pid, and the port when known. ' +
          'Check this before adding or starting anything. Read-only.',
      },
    }),
    ...workspaceScoped,
    (c) => {
      const apps = listApps(c.var.db, {
        userId: c.var.user.id,
        workspaceId: c.var.workspace!.id,
      })
      return c.json(
        apps.map((app) => serializeAppForResponse(app, c.var.appSupervisor.snapshotOf(app.id))),
      )
    },
  )
  // POST / — register an app (Claude adding what it needs, or the user's dialog).
  .post(
    '/',
    describeRoute({
      tags: ['apps'],
      summary: 'Register a runnable app on the workspace.',
      'x-sdk-name': 'workspaceApps.add',
      responses: {
        201: {
          description: 'App registered.',
          content: { 'application/json': { schema: resolver(WorkspaceAppResponseSchema) } },
        },
        400: { description: 'Validation error.' },
        404: { description: 'Workspace not found.' },
        409: { description: 'An app with this name already exists here.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'add_app',
        description:
          'Register a runnable app on the workspace so it can be started, stopped, and ' +
          'monitored. Derive the right `command` by inspecting the workspace first (package.json ' +
          'scripts, monorepo layout) — never guess. `name` is plain language the user recognizes ' +
          '("Web app", "API server"). `cwdRelative` is the folder under the workspace root the ' +
          'command runs in ("" = root). Set `port` when you know it — it powers the "open in ' +
          'browser" link. Set `envFileRelative` to the env file the app loads, relative to its ' +
          "folder (defaults to \".env\") — the user edits that file from the app's Env popup. " +
          'Add an app once and reuse it; check list_apps before adding.',
        mutatingApproved: true,
      },
    }),
    validator('json', RegisterAppRequestSchema),
    ...workspaceScoped,
    (c) => {
      const body = c.req.valid('json')
      const app = registerApp(
        c.var.db,
        {
          userId: c.var.user.id,
          workspaceId: c.var.workspace!.id,
          name: body.name,
          command: body.command,
          ...(body.cwdRelative !== undefined ? { cwdRelative: body.cwdRelative } : {}),
          ...(body.envFileRelative !== undefined
            ? { envFileRelative: body.envFileRelative }
            : {}),
          ...(body.port !== undefined ? { port: body.port } : {}),
        },
        { logger: c.var.logger },
      )
      return c.json(serializeAppForResponse(app, null), 201)
    },
  )
  // PATCH /:appId — edit (a running app keeps its old process until restarted).
  .patch(
    '/:appId',
    describeRoute({
      tags: ['apps'],
      summary: 'Update an app (name, command, folder, port). Applies on the next start.',
      'x-sdk-name': 'workspaceApps.update',
      responses: {
        200: {
          description: 'App updated.',
          content: { 'application/json': { schema: resolver(WorkspaceAppResponseSchema) } },
        },
        400: { description: 'Validation error.' },
        404: { description: 'No such app in this workspace.' },
        409: { description: 'An app with this name already exists here.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'update_app',
        description:
          "Update a registered app's name, command, folder, env file path, or port. A running " +
          'app keeps its current process — the change applies on the next start (stop_app then ' +
          'start_app to restart with the new command).',
        mutatingApproved: true,
      },
    }),
    validator('param', AppParamSchema),
    validator('json', UpdateAppRequestSchema),
    ...workspaceScoped,
    (c) => {
      const body = c.req.valid('json')
      const appId = c.req.valid('param').appId
      // Workspace binding first (identical 404), then the owner-scoped patch.
      getAppOrThrow(c.var.db, {
        appId,
        userId: c.var.user.id,
        workspaceId: c.var.workspace!.id,
      })
      const app = updateApp(
        c.var.db,
        {
          appId,
          userId: c.var.user.id,
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.command !== undefined ? { command: body.command } : {}),
          ...(body.cwdRelative !== undefined ? { cwdRelative: body.cwdRelative } : {}),
          ...(body.envFileRelative !== undefined
            ? { envFileRelative: body.envFileRelative }
            : {}),
          ...(body.port !== undefined ? { port: body.port } : {}),
        },
        { logger: c.var.logger },
      )
      return c.json(serializeAppForResponse(app, c.var.appSupervisor.snapshotOf(app.id)))
    },
  )
  // DELETE /:appId — stop it if running, then remove. User-only (no x-mcp).
  .delete(
    '/:appId',
    describeRoute({
      tags: ['apps'],
      summary: 'Remove an app (stops it first if running).',
      'x-sdk-name': 'workspaceApps.remove',
      responses: {
        204: { description: 'App removed.' },
        404: { description: 'No such app in this workspace.' },
      },
    }),
    validator('param', AppParamSchema),
    ...workspaceScoped,
    async (c) => {
      const appId = c.req.valid('param').appId
      const app = getAppOrThrow(c.var.db, {
        appId,
        userId: c.var.user.id,
        workspaceId: c.var.workspace!.id,
      })
      if (c.var.appSupervisor.isRunning(app.id)) {
        await c.var.appSupervisor.stop(app.id)
        publishAppRuntimeEvent(c.var.db, app, { kind: 'stopped' })
      }
      removeApp(c.var.db, { appId: app.id, userId: c.var.user.id }, { logger: c.var.logger })
      return c.body(null, 204)
    },
  )
  // POST /:appId/start — spawn it (uncarded by design).
  .post(
    '/:appId/start',
    describeRoute({
      tags: ['apps'],
      summary: 'Start an app.',
      'x-sdk-name': 'workspaceApps.start',
      responses: {
        200: {
          description: 'App started (runtime merged).',
          content: { 'application/json': { schema: resolver(WorkspaceAppResponseSchema) } },
        },
        400: { description: "The app's folder escapes the workspace." },
        404: { description: 'No such app in this workspace.' },
        409: { description: 'The app is already running.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'start_app',
        description:
          "Start a registered app. The user sees it go green in their Apps section. After " +
          'starting, give it a moment and check get_app_logs to confirm it came up healthy ' +
          '(port conflicts and missing installs show up there).',
        mutatingApproved: true,
      },
    }),
    validator('param', AppParamSchema),
    ...workspaceScoped,
    (c) => {
      const app = getAppOrThrow(c.var.db, {
        appId: c.req.valid('param').appId,
        userId: c.var.user.id,
        workspaceId: c.var.workspace!.id,
      })
      try {
        const snapshot = c.var.appSupervisor.start({
          appId: app.id,
          name: app.name,
          command: app.command,
          workspacePath: c.var.workspace!.path,
          cwdRelative: app.cwdRelative,
        })
        publishAppRuntimeEvent(c.var.db, app, { kind: 'started' })
        return c.json(serializeAppForResponse(app, snapshot))
      } catch (err) {
        // The supervisor is taxonomy-free by design — translate here.
        const message = err instanceof Error ? err.message : String(err)
        if (message.startsWith('app_already_running')) {
          throw new ConflictError(`"${app.name}" is already running.`)
        }
        if (message.startsWith('app_cwd_escapes_workspace')) {
          throw new ValidationError('The app folder must be inside the workspace.')
        }
        throw err
      }
    },
  )
  // POST /:appId/stop — graceful tree-kill (idempotent).
  .post(
    '/:appId/stop',
    describeRoute({
      tags: ['apps'],
      summary: 'Stop a running app.',
      'x-sdk-name': 'workspaceApps.stop',
      responses: {
        200: {
          description: 'App stopped (runtime merged).',
          content: { 'application/json': { schema: resolver(WorkspaceAppResponseSchema) } },
        },
        404: { description: 'No such app in this workspace.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'stop_app',
        description:
          'Stop a running app (the whole process tree, so its port frees up). Stopping an app ' +
          'that is not running is a harmless no-op.',
        mutatingApproved: true,
      },
    }),
    validator('param', AppParamSchema),
    ...workspaceScoped,
    async (c) => {
      const app = getAppOrThrow(c.var.db, {
        appId: c.req.valid('param').appId,
        userId: c.var.user.id,
        workspaceId: c.var.workspace!.id,
      })
      const wasRunning = c.var.appSupervisor.isRunning(app.id)
      await c.var.appSupervisor.stop(app.id)
      if (wasRunning) publishAppRuntimeEvent(c.var.db, app, { kind: 'stopped' })
      return c.json(serializeAppForResponse(app, c.var.appSupervisor.snapshotOf(app.id)))
    },
  )
  // GET /:appId/logs — the live ring-buffer tail (nothing on disk by design).
  .get(
    '/:appId/logs',
    describeRoute({
      tags: ['apps'],
      summary: "Read an app's recent output (live ring buffer).",
      'x-sdk-name': 'workspaceApps.logs',
      responses: {
        200: {
          description: '{ lines } — the most recent output lines.',
          content: { 'application/json': { schema: resolver(AppLogsResponseSchema) } },
        },
        404: { description: 'No such app in this workspace.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'get_app_logs',
        description:
          "Read an app's recent output (up to the last 2000 lines, in-memory — empty if it has " +
          'not run since Vynel started). Use after start_app to confirm health, or to diagnose ' +
          'a crash (the exit line is appended). Optional `tail` limits the line count. Read-only.',
      },
    }),
    validator('param', AppParamSchema),
    validator('query', AppLogsQuerySchema),
    ...workspaceScoped,
    (c) => {
      const app = getAppOrThrow(c.var.db, {
        appId: c.req.valid('param').appId,
        userId: c.var.user.id,
        workspaceId: c.var.workspace!.id,
      })
      const { tail } = c.req.valid('query')
      return c.json({ lines: c.var.appSupervisor.logsOf(app.id, tail ?? 200) })
    },
  )
  // GET /:appId/env — parse the app's env file (user-only; env values are
  // secrets and never become MCP tool results).
  .get(
    '/:appId/env',
    describeRoute({
      tags: ['apps'],
      summary: "Read the app's env file as key/value entries.",
      'x-sdk-name': 'workspaceApps.env',
      responses: {
        200: {
          description: '{ envFileRelative, exists, entries } — parsed from the file on disk.',
          content: { 'application/json': { schema: resolver(AppEnvResponseSchema) } },
        },
        400: { description: 'The env file path escapes the workspace.' },
        404: { description: 'No such app in this workspace.' },
      },
    }),
    validator('param', AppParamSchema),
    ...workspaceScoped,
    (c) => {
      const app = getAppOrThrow(c.var.db, {
        appId: c.req.valid('param').appId,
        userId: c.var.user.id,
        workspaceId: c.var.workspace!.id,
      })
      try {
        const file = readAppEnvFile({
          workspacePath: c.var.workspace!.path,
          cwdRelative: app.cwdRelative,
          envFileRelative: app.envFileRelative,
        })
        return c.json({ envFileRelative: app.envFileRelative, ...file })
      } catch (err) {
        // The env ops are taxonomy-free by design — translate here (the
        // supervisor-error precedent).
        const message = err instanceof Error ? err.message : String(err)
        if (message.startsWith('app_env_escapes_workspace')) {
          throw new ValidationError('The env file must be inside the workspace.')
        }
        throw err
      }
    },
  )
  // PUT /:appId/env — write the FULL desired entry set (user-only). The write
  // is line-preserving: comments and unknown lines in the file survive.
  .put(
    '/:appId/env',
    describeRoute({
      tags: ['apps'],
      summary: "Replace the app's env vars (line-preserving file rewrite).",
      'x-sdk-name': 'workspaceApps.updateEnv',
      responses: {
        200: {
          description: 'The saved state, re-parsed from the file.',
          content: { 'application/json': { schema: resolver(AppEnvResponseSchema) } },
        },
        400: { description: "Validation error, or the app's folder does not exist." },
        404: { description: 'No such app in this workspace.' },
      },
    }),
    validator('param', AppParamSchema),
    validator('json', UpdateAppEnvRequestSchema),
    ...workspaceScoped,
    (c) => {
      const app = getAppOrThrow(c.var.db, {
        appId: c.req.valid('param').appId,
        userId: c.var.user.id,
        workspaceId: c.var.workspace!.id,
      })
      try {
        const entries = writeAppEnvFile(
          {
            workspacePath: c.var.workspace!.path,
            cwdRelative: app.cwdRelative,
            envFileRelative: app.envFileRelative,
          },
          c.req.valid('json').entries,
        )
        // Never log the values — keys and count only.
        c.var.logger.info(
          { appId: app.id, entryCount: entries.length },
          'app env file updated',
        )
        return c.json({ envFileRelative: app.envFileRelative, exists: true, entries })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (message.startsWith('app_env_escapes_workspace')) {
          throw new ValidationError('The env file must be inside the workspace.')
        }
        if (message.startsWith('app_env_folder_missing')) {
          throw new ValidationError(
            "The app's folder does not exist on disk, so its env file can't be created.",
          )
        }
        if (message.startsWith('app_env_multiline_file')) {
          throw new ValidationError(
            "This env file uses multi-line quoted values, which Vynel can't rewrite " +
              'safely — edit it in your code editor instead.',
          )
        }
        if (
          message.startsWith('app_env_invalid_key') ||
          message.startsWith('app_env_multiline_value') ||
          message.startsWith('app_env_duplicate_key')
        ) {
          throw new ValidationError(
            'Env entries need unique keys (letters, digits, underscores) and single-line values.',
          )
        }
        throw err
      }
    },
  )
