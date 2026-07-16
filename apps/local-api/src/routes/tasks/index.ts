// The workspace-scoped `tasks` HTTP surface — mounted under
// `/workspaces/:workspaceId/tasks` from `apps/local-api/src/app.ts`:
//
//   GET    /                  -> listTasks                    [x-mcp]
//   POST   /                  -> createTask (source=assistant) [x-mcp, mutatingApproved]
//   PATCH  /:taskId           -> updateTask                    [x-mcp, mutatingApproved]
//   POST   /:taskId/complete  -> updateTask(status=done)       [x-mcp, mutatingApproved]
//
// THIS IS THE AGENT'S SURFACE. The agent SDK has no built-in task feature —
// these four tools are how Claude keeps the user's task list current during a
// turn. `POST /` hard-codes `source: 'assistant'` (there is no source field in
// the body to spoof); the USER's create/delete doors live on the user-scoped
// twin (`/tasks`, source='user'), which is what the panel + CLI call. The
// `tasks.*` SDK namespace exists as a generation artifact — app surfaces use
// `tasksUser.*`.
//
// Task writes are deliberately UNCARDED (mutatingApproved, like memory
// writes): low-stakes, fully visible in the panel, trivially reversible.
// Delete is NOT exposed to the agent — reopening/completing covers its needs;
// removal is the user's call.
//
// Locked Hono protocol: describeRoute → validator → `...workspaceScoped` →
// handler on `factory.createApp()`; handlers THROW typed VynelError
// subclasses (the app.ts onError maps them).

import { resolver, validator } from 'hono-openapi/zod'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { workspaceScoped } from '../../handler-bundles/workspace-scoped.js'
import { createTask, listTasks, updateTask } from '@vynel/tasks'
import { serializeTaskForResponse } from './serializers.js'
import {
  TaskParamSchema,
  ListTasksQuerySchema,
  CreateTaskRequestSchema,
  UpdateTaskRequestSchema,
  TaskResponseSchema,
  ListTasksResponseSchema,
} from './schemas.js'

export const tasksApp = factory
  .createApp()
  // GET / — list the workspace's tasks (owner-scoped; optional status filter).
  .get(
    '/',
    describeRoute({
      tags: ['tasks'],
      summary: 'List tasks for the active workspace (owner-scoped).',
      'x-sdk-name': 'tasks.list',
      responses: {
        200: {
          description: 'Array of Task.',
          content: { 'application/json': { schema: resolver(ListTasksResponseSchema) } },
        },
        404: { description: 'Workspace not found.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'list_tasks',
        description:
          "List the active workspace's task list (owner-scoped). Each task has a title, optional " +
          'detail, status (open / in-progress / done), and who created it (assistant or user). ' +
          'Optional `status` query filters to one status. Check this at the start of multi-step ' +
          'work to see what is already tracked. Read-only.',
      },
    }),
    validator('query', ListTasksQuerySchema),
    ...workspaceScoped,
    (c) => {
      const { status } = c.req.valid('query')
      const tasks = listTasks(c.var.db, {
        userId: c.var.user.id,
        workspaceId: c.var.workspace!.id,
        ...(status !== undefined ? { status } : {}),
      })
      return c.json(tasks.map(serializeTaskForResponse))
    },
  )
  // POST / — the AGENT's create door (source is hard-coded 'assistant').
  .post(
    '/',
    describeRoute({
      tags: ['tasks'],
      summary: "Create a task on the active workspace's list (assistant provenance).",
      'x-sdk-name': 'tasks.create',
      responses: {
        201: {
          description: 'Task created.',
          content: { 'application/json': { schema: resolver(TaskResponseSchema) } },
        },
        400: { description: 'Validation error.' },
        404: { description: 'Workspace not found.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'create_task',
        description:
          "Add a task to the workspace's task list. Use this when the user asks for work with " +
          'more than one step, or agrees to something you will do later — one task per distinct ' +
          'piece of work, phrased in plain language the user recognizes (e.g. "Write the spring ' +
          'newsletter draft"), never technical mechanics. `title` is the short label (≤200 chars); ' +
          '`detail` is optional context. New tasks start as status "open"; move them with ' +
          'update_task / complete_task as you work. Do not narrate the bookkeeping — just keep the ' +
          "list current. Side effect: the task appears in the user's task panel and dashboard.",
        mutatingApproved: true,
      },
    }),
    validator('json', CreateTaskRequestSchema),
    ...workspaceScoped,
    (c) => {
      const body = c.req.valid('json')
      const task = createTask(
        c.var.db,
        {
          userId: c.var.user.id,
          workspaceId: c.var.workspace!.id,
          title: body.title,
          source: 'assistant',
          ...(body.detail !== undefined ? { detail: body.detail } : {}),
          ...(body.sessionId !== undefined ? { sessionId: body.sessionId } : {}),
        },
        { logger: c.var.logger },
      )
      return c.json(serializeTaskForResponse(task), 201)
    },
  )
  // PATCH /:taskId — update title/detail/status (owner-scoped).
  .patch(
    '/:taskId',
    describeRoute({
      tags: ['tasks'],
      summary: 'Update a task (title, detail, or status).',
      'x-sdk-name': 'tasks.update',
      responses: {
        200: {
          description: 'Task updated.',
          content: { 'application/json': { schema: resolver(TaskResponseSchema) } },
        },
        400: { description: 'Validation error.' },
        404: { description: 'No such task owned by this user.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'update_task',
        description:
          'Update a task on the workspace\'s list. Set status "in-progress" when you start ' +
          'working on it, back to "open" if you stop, or "done" when finished (complete_task is ' +
          'the shortcut for that). Title/detail edits keep the wording current if the work ' +
          'changes shape. Statuses: open / in-progress / done.',
        mutatingApproved: true,
      },
    }),
    validator('param', TaskParamSchema),
    validator('json', UpdateTaskRequestSchema),
    ...workspaceScoped,
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
  // POST /:taskId/complete — mark done (stamps completedAt; emits task.completed).
  .post(
    '/:taskId/complete',
    describeRoute({
      tags: ['tasks'],
      summary: 'Mark a task done.',
      'x-sdk-name': 'tasks.complete',
      responses: {
        200: {
          description: 'Task completed.',
          content: { 'application/json': { schema: resolver(TaskResponseSchema) } },
        },
        404: { description: 'No such task owned by this user.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'complete_task',
        description:
          'Mark a task done the moment its work is finished and verified — not before. The user ' +
          "sees completed tasks on their dashboard as the record of what you've delivered.",
        mutatingApproved: true,
      },
    }),
    validator('param', TaskParamSchema),
    ...workspaceScoped,
    (c) => {
      const task = updateTask(
        c.var.db,
        { taskId: c.req.valid('param').taskId, userId: c.var.user.id, status: 'done' },
        { logger: c.var.logger },
      )
      return c.json(serializeTaskForResponse(task))
    },
  )
