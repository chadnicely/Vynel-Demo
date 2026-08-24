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
import { countStepsForTasks, createTask, listTasks, replaceTaskSteps, updateTask } from '@vynel/tasks'
// The ownership-checked turn-session resolution moved to the header module
// (one home) when the journal became its second consumer.
import {
  TURN_SESSION_HEADER,
  resolveOwnedTurnSessionId,
} from '../../sessions/turn-session-header.js'
import { serializeTaskForResponse, serializeTasksWithStepCounts, serializeTaskStepForResponse } from './serializers.js'
import {
  TaskParamSchema,
  ListTasksQuerySchema,
  CreateTaskRequestSchema,
  UpdateTaskRequestSchema,
  SetTaskStepsRequestSchema,
  TaskResponseSchema,
  ListTasksResponseSchema,
  ListTaskStepsResponseSchema,
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
          'detail, status (open / in-progress / done), who created it (assistant or user), and an ' +
          'optional planId linking it to a plan. Optional `status` query filters to one status; ' +
          "optional `planId` narrows to one plan's work items. Check this at the start of " +
          'multi-step work to see what is already tracked. Read-only.',
      },
    }),
    validator('query', ListTasksQuerySchema),
    ...workspaceScoped,
    (c) => {
      const { status, planId } = c.req.valid('query')
      const tasks = listTasks(c.var.db, {
        userId: c.var.user.id,
        workspaceId: c.var.workspace!.id,
        ...(status !== undefined ? { status } : {}),
        ...(planId !== undefined ? { planId } : {}),
      })
      const stepCounts = countStepsForTasks(c.var.db, {
        userId: c.var.user.id,
        taskIds: tasks.map((task) => task.id),
      })
      return c.json(serializeTasksWithStepCounts(tasks, stepCounts))
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
          '`detail` is optional context; `planId` links the task to a plan (list_plans) when it ' +
          'is part of one. New tasks start as status "open"; move them with ' +
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
          ...(body.planId !== undefined ? { planId: body.planId } : {}),
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
          'changes shape; `planId` attaches the task to a plan (null detaches). Statuses: ' +
          'open / in-progress / done.',
        mutatingApproved: true,
      },
    }),
    validator('param', TaskParamSchema),
    validator('json', UpdateTaskRequestSchema),
    ...workspaceScoped,
    (c) => {
      const body = c.req.valid('json')
      // PICKUP STAMP: the agent moving a task to in-progress assigns it to the
      // session doing the work — read from the ambient turn-session header
      // (server-stamped, never a body field), absent on turns with no watching
      // session. Only this door stamps: the user ticking a status in the panel
      // is not a pickup.
      const turnSessionId =
        body.status === 'in-progress'
          ? resolveOwnedTurnSessionId(c.var.db, c.var.user.id, c.req.header(TURN_SESSION_HEADER))
          : undefined
      const task = updateTask(
        c.var.db,
        {
          taskId: c.req.valid('param').taskId,
          userId: c.var.user.id,
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.detail !== undefined ? { detail: body.detail } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.planId !== undefined ? { planId: body.planId } : {}),
          ...(turnSessionId !== undefined ? { assignedSessionId: turnSessionId } : {}),
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
  // PUT /:taskId/steps — the AGENT's whole-list step replace. The writing
  // session comes from the ambient header WHEN PRESENT (unlike the retired set_todos door this
  // never 400s without one — steps anchor to the TASK, and background turns
  // legitimately manage them); the task row supplies the scope.
  .put(
    '/:taskId/steps',
    describeRoute({
      tags: ['tasks'],
      summary: "Replace a task's execution steps (whole-list).",
      'x-sdk-name': 'tasks.setSteps',
      responses: {
        200: {
          description: 'The stored list, in order.',
          content: { 'application/json': { schema: resolver(ListTaskStepsResponseSchema) } },
        },
        400: { description: 'Validation error.' },
        404: { description: 'No such task owned by this user.' },
      },
      'x-mcp': {
        exposed: true,
        name: 'set_task_steps',
        description:
          "Lay out (or revise) a task's execution steps — the durable checklist the user watches " +
          'on the task panel, where each row shows its steps and an n/m progress count. Send the ' +
          "task's COMPLETE current list every time: `steps` is an array of objects, each " +
          '{ "title": "<short step in plain language>", "status": "open" | "in-progress" | "done" }, ' +
          'in working order — the list is REPLACED wholesale, so omit a step and it disappears. ' +
          'Set `planId` when the steps come from a plan (create_plan first for medium/large work). ' +
          'Exactly one step should be "in-progress" at a time; update the list the moment a step ' +
          'starts or finishes. Titles are what the user reads ("Draft the newsletter"), never ' +
          "technical mechanics. Steps are the task's plan-of-record — they persist until the task " +
          'is deleted. Do not narrate the ' +
          'bookkeeping in your reply.',
        mutatingApproved: true,
      },
    }),
    validator('param', TaskParamSchema),
    validator('json', SetTaskStepsRequestSchema),
    ...workspaceScoped,
    (c) => {
      const body = c.req.valid('json')
      const turnSessionId = resolveOwnedTurnSessionId(
        c.var.db,
        c.var.user.id,
        c.req.header(TURN_SESSION_HEADER),
      )
      const steps = replaceTaskSteps(
        c.var.db,
        {
          userId: c.var.user.id,
          taskId: c.req.valid('param').taskId,
          steps: body.steps,
          ...(body.planId !== undefined ? { planId: body.planId } : {}),
          ...(turnSessionId !== undefined ? { sessionId: turnSessionId } : {}),
        },
        { logger: c.var.logger },
      )
      return c.json(steps.map(serializeTaskStepForResponse))
    },
  )
