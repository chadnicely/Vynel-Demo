// The `todos` HTTP surface — the WORKING-STEPS dock above the chat composer.
// Mounted at `/todos` (no workspace prefix: a session's steps follow the
// SESSION, and a session may have no workspace at all) from
// `apps/local-api/src/app.ts`:
//
//   PUT    /            -> replaceSessionTodos (agent door — MCP disconnected)
//   GET    /?sessionId= -> listTodosForSession                        ← USER door
//   PATCH  /:todoId     -> updateTodoStatus                           ← USER door
//   DELETE /:todoId     -> deleteTodo (hard delete)                   ← USER door
//
// THE DOCK IS RETIRED (2026-08-24): the task panel's tasks + steps
// (set_task_steps) are the one visible work-tracking home, so `set_todos` no
// longer ships as a tool — the `PUT /` route keeps the contract (ambient
// turn-session header, whole-list replace) for a deliberate reconnect, but
// carries no x-mcp exposure and the TodoDock render sits commented out in the
// views.
//
// THE SESSION IS NEVER A PARAMETER on the agent door. `PUT /` reads the
// ambient `x-vynel-turn-session` header the turn stamps server-side
// (`sessions/turn-session-header.ts`), then resolves that chat session and
// takes its workspace scope from the row — so neither the session nor its
// scope can be model-supplied. A turn with no watching session (a schedule
// fire, a delegation tick) carries no header and the tool 400s honestly, the
// way `send_message` to "requester" does when a turn has no requester.
//
// Locked Hono protocol: describeRoute → validator → `...userScoped` → handler
// on `factory.createApp()`; handlers THROW typed VynelError subclasses (the
// app.ts onError maps them).

import { resolver, validator } from 'hono-openapi/zod'
import { ValidationError, NotFoundError } from '@vynel/errors'
import { findChatSessionById } from '@vynel/chat/repositories'
import { deleteTodo, listTodosForSession, replaceSessionTodos, updateTodoStatus } from '@vynel/tasks'
import { factory } from '../../factory.js'
import { describeRoute } from '../../openapi.js'
import { userScoped } from '../../handler-bundles/user-scoped.js'
import {
  TURN_SESSION_HEADER,
  parseTurnSessionHeader,
} from '../../sessions/turn-session-header.js'
import { serializeSessionTodoForResponse } from './serializers.js'
import {
  TodoParamSchema,
  ListTodosQuerySchema,
  SetTodosRequestSchema,
  UpdateTodoStatusRequestSchema,
  SessionTodoResponseSchema,
  ListSessionTodosResponseSchema,
} from './schemas.js'

export const todosApp = factory
  .createApp()
  // PUT / — the AGENT's whole-list replace. Session identity comes from the
  // ambient header, never the body.
  .put(
    '/',
    describeRoute({
      tags: ['todos'],
      summary: "Replace the calling session's working-step list.",
      'x-sdk-name': 'todos.setForSession',
      responses: {
        200: {
          description: 'The stored list, in order.',
          content: { 'application/json': { schema: resolver(ListSessionTodosResponseSchema) } },
        },
        400: { description: 'Validation error, or this turn has no watching session.' },
        404: { description: 'The calling session could not be resolved.' },
      },
    }),
    validator('json', SetTodosRequestSchema),
    ...userScoped,
    (c) => {
      const turnSessionId = parseTurnSessionHeader(c.req.header(TURN_SESSION_HEADER))
      if (turnSessionId === undefined) {
        throw new ValidationError(
          'This turn has no session the user is watching, so there is no step list to keep. ' +
            'Carry on with the work and report the outcome in your reply.',
        )
      }
      // The session row is BOTH the ownership check and the scope source — the
      // todo's workspaceId is copied from it, so it can never be model-supplied.
      const session = findChatSessionById(c.var.db, turnSessionId)
      if (session === null || session.userId !== c.var.user.id) {
        throw new NotFoundError('session', turnSessionId)
      }
      const todos = replaceSessionTodos(
        c.var.db,
        {
          userId: c.var.user.id,
          workspaceId: session.workspaceId,
          sessionId: session.id,
          todos: c.req.valid('json').todos,
        },
        { logger: c.var.logger },
      )
      return c.json(todos.map(serializeSessionTodoForResponse))
    },
  )
  // GET /?sessionId= — the dock's read (owner-scoped).
  .get(
    '/',
    describeRoute({
      tags: ['todos'],
      summary: "List one session's working steps, in order.",
      'x-sdk-name': 'todos.list',
      responses: {
        200: {
          description: 'Array of SessionTodo.',
          content: { 'application/json': { schema: resolver(ListSessionTodosResponseSchema) } },
        },
        400: { description: 'Validation error.' },
      },
    }),
    validator('query', ListTodosQuerySchema),
    ...userScoped,
    (c) => {
      const todos = listTodosForSession(c.var.db, {
        userId: c.var.user.id,
        sessionId: c.req.valid('query').sessionId,
      })
      return c.json(todos.map(serializeSessionTodoForResponse))
    },
  )
  // PATCH /:todoId — the user ticking a box in the dock.
  .patch(
    '/:todoId',
    describeRoute({
      tags: ['todos'],
      summary: 'Move a working step (open / in-progress / done).',
      'x-sdk-name': 'todos.updateStatus',
      responses: {
        200: {
          description: 'Step updated.',
          content: { 'application/json': { schema: resolver(SessionTodoResponseSchema) } },
        },
        400: { description: 'Validation error.' },
        404: { description: 'No such step owned by this user.' },
      },
    }),
    validator('param', TodoParamSchema),
    validator('json', UpdateTodoStatusRequestSchema),
    ...userScoped,
    (c) => {
      const todo = updateTodoStatus(
        c.var.db,
        {
          todoId: c.req.valid('param').todoId,
          userId: c.var.user.id,
          status: c.req.valid('json').status,
        },
        { logger: c.var.logger },
      )
      return c.json(serializeSessionTodoForResponse(todo))
    },
  )
  // DELETE /:todoId — remove a step (hard delete; the user's call, never the agent's).
  .delete(
    '/:todoId',
    describeRoute({
      tags: ['todos'],
      summary: 'Remove a working step (hard delete).',
      'x-sdk-name': 'todos.delete',
      responses: {
        204: { description: 'Step removed.' },
        404: { description: 'No such step owned by this user.' },
      },
    }),
    validator('param', TodoParamSchema),
    ...userScoped,
    (c) => {
      deleteTodo(
        c.var.db,
        { todoId: c.req.valid('param').todoId, userId: c.var.user.id },
        { logger: c.var.logger },
      )
      return c.body(null, 204)
    },
  )
