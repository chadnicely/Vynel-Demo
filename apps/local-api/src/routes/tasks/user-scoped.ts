// The USER-scoped `tasks` HTTP surface — mounted at `/tasks` (NO workspace
// prefix) from `apps/local-api/src/app.ts`, alongside the workspace-scoped
// twin (`/workspaces/:workspaceId/tasks`). These routes span BOTH scopes: a
// user's GLOBAL (null-workspace) tasks AND every workspace task they own —
// the surface behind the task panel, the dashboard, and the CLI.
//
//   GET    /                  -> listTasksForUser  [x-mcp: list_my_tasks]
//   POST   /                  -> createTask (scope: global|workspace; source=user)
//   PATCH  /:taskId           -> updateTask
//   DELETE /:taskId           -> deleteTask (hard delete)
//
// THIS IS THE USER'S SURFACE: `POST /` hard-codes `source: 'user'` (the agent
// creates through its workspace-scoped door, which hard-codes 'assistant' —
// provenance is unspoofable by construction). Only the safe-read `GET /` is
// x-mcp exposed; the mutating routes are panel/CLI-only — the agent's write
// tools live on the workspace-scoped twin. The id-ops authorize by userId
// (the tenant boundary); not-found and not-owned both return an identical 404
// (no enumeration leak).
//
// Locked Hono protocol: describeRoute → validator → `...userScoped` → handler
// on `factory.createApp()`; handlers THROW typed VynelError subclasses (the
// app.ts onError maps them).

import { resolver, validator } from 'hono-openapi/zod'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import { createTask, deleteTask, listTasksForUser, updateTask } from '@vynel/tasks'
import { serializeTaskForResponse } from './serializers.js'
import {
  TaskParamSchema,
  ListTasksQuerySchema,
  CreateTaskForUserRequestSchema,
  UpdateTaskRequestSchema,
  TaskResponseSchema,
  ListTasksResponseSchema,
} from './schemas.js'

export const tasksUserApp = factory
  .createApp()
  // GET / — every task the user owns, both scopes (optional status filter).
  .get(
    '/',
    describeRoute({
      tags: ['tasks'],
      summary: 'List every task the user owns — global + workspace.',
      'x-sdk-name': 'tasksUser.list',
      responses: {
        200: {
          description: 'Array of Task.',
          content: { 'application/json': { schema: resolver(ListTasksResponseSchema) } },
        },
      },
      'x-mcp': {
        exposed: true,
        name: 'list_my_tasks',
        description:
          'List every task the user owns — both global (no workspace) and workspace-scoped. ' +
          'Each has a title, optional detail, status (open / in-progress / done), and who created ' +
          'it. Optional `status` query filters to one status. Read-only.',
      },
    }),
    validator('query', ListTasksQuerySchema),
    ...userScoped,
    (c) => {
      const { status } = c.req.valid('query')
      const tasks = listTasksForUser(c.var.db, {
        userId: c.var.user.id,
        ...(status !== undefined ? { status } : {}),
      })
      return c.json(tasks.map(serializeTaskForResponse))
    },
  )
  // POST / — the USER's create door; scope picks global (null workspace) vs a workspace.
  .post(
    '/',
    describeRoute({
      tags: ['tasks'],
      summary: 'Create a global or workspace task (user provenance).',
      'x-sdk-name': 'tasksUser.create',
      responses: {
        201: {
          description: 'Task created.',
          content: { 'application/json': { schema: resolver(TaskResponseSchema) } },
        },
        400: { description: 'Validation error, or workspaceId missing for a workspace scope.' },
      },
    }),
    validator('json', CreateTaskForUserRequestSchema),
    ...userScoped,
    (c) => {
      const body = c.req.valid('json')
      const task = createTask(
        c.var.db,
        {
          userId: c.var.user.id,
          workspaceId: body.scope === 'global' ? null : body.workspaceId,
          title: body.title,
          source: 'user',
          ...(body.detail !== undefined ? { detail: body.detail } : {}),
        },
        { logger: c.var.logger },
      )
      return c.json(serializeTaskForResponse(task), 201)
    },
  )
  // PATCH /:taskId — update a task the user owns (title, detail, status).
  .patch(
    '/:taskId',
    describeRoute({
      tags: ['tasks'],
      summary: 'Update a task the user owns (title, detail, or status).',
      'x-sdk-name': 'tasksUser.update',
      responses: {
        200: {
          description: 'Task updated.',
          content: { 'application/json': { schema: resolver(TaskResponseSchema) } },
        },
        400: { description: 'Validation error.' },
        404: { description: 'No such task owned by this user.' },
      },
    }),
    validator('param', TaskParamSchema),
    validator('json', UpdateTaskRequestSchema),
    ...userScoped,
    (c) => {
      const body = c.req.valid('json')
      const task = updateTask(
        c.var.db,
        {
          taskId: c.req.valid('param').taskId,
          userId: c.var.user.id,
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.detail !== undefined ? { detail: body.detail } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
        },
        { logger: c.var.logger },
      )
      return c.json(serializeTaskForResponse(task))
    },
  )
  // DELETE /:taskId — remove a task (hard delete; the user's call, never the agent's).
  .delete(
    '/:taskId',
    describeRoute({
      tags: ['tasks'],
      summary: 'Delete a task the user owns (hard delete).',
      'x-sdk-name': 'tasksUser.delete',
      responses: {
        204: { description: 'Task deleted.' },
        404: { description: 'No such task owned by this user.' },
      },
    }),
    validator('param', TaskParamSchema),
    ...userScoped,
    (c) => {
      deleteTask(
        c.var.db,
        { taskId: c.req.valid('param').taskId, userId: c.var.user.id },
        { logger: c.var.logger },
      )
      return c.body(null, 204)
    },
  )
