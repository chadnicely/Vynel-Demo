// Integration tests for `/todos` — the working-steps dock. Full HTTP stack:
// route -> validator -> userScoped -> core op -> repo -> SQLite (real, via
// withTestDatabase). No mocks.
//
// TENANT-ISOLATION ordering invariant: the Phase-1 resolver returns the FIRST
// user row (`findSingleLocalUser` = limit(1)), so the "attacker" (the resolved
// local user) is `insertUser`'d BEFORE the victim's rows.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { insertChatSession, type NewChatSession } from '@vynel/chat/repositories'
import { insertSessionTodo, makeSessionTodo } from '@vynel/tasks/test-support'
import { createApp } from '../../app.js'
import { TURN_SESSION_HEADER } from '../../sessions/turn-session-header.js'
import type { Database } from '@vynel/db'
import type { SessionTodoResponse } from '@vynel/contracts/tasks/session-todo-http'

const silentLogger = pino({ level: 'silent' })

function makeUser() {
  const now = new Date()
  return {
    id: randomUUID(),
    displayName: 'Dana',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  }
}

function seedWorkspace(db: Database, userId: string) {
  const now = new Date()
  return insertWorkspace(db, {
    id: randomUUID(),
    userId,
    name: 'Bakery',
    kind: 'small-business',
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
}

function makeSession(userId: string, workspaceId: string | null): NewChatSession {
  const now = new Date()
  return {
    id: `session-${randomUUID()}`,
    userId,
    workspaceId,
    providerId: 'claude',
    title: 'A conversation',
    isArchived: false,
    deletedAt: null,
    totalMessageCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    startedAt: now,
    lastMessageAt: now,
    updatedAt: now,
  }
}

function setTodos(
  app: ReturnType<typeof createApp>,
  payload: unknown,
  headers: Record<string, string> = {},
) {
  return app.request('/todos', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  })
}

describe('PUT /todos — the agent door', () => {
  it('replaces the list for the SESSION IN THE AMBIENT HEADER, scoped from the session row', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const user = insertUser(db, makeUser())
      const workspace = seedWorkspace(db, user.id)
      const session = insertChatSession(db, makeSession(user.id, workspace.id))

      const res = await setTodos(
        app,
        {
          todos: [
            { title: 'Read the brief', status: 'done' },
            { title: 'Draft the copy', status: 'in-progress' },
          ],
        },
        { [TURN_SESSION_HEADER]: session.id },
      )
      expect(res.status).toBe(200)
      const todos = (await res.json()) as SessionTodoResponse[]
      expect(todos.map((todo) => todo.title)).toEqual(['Read the brief', 'Draft the copy'])
      expect(todos.map((todo) => todo.orderIndex)).toEqual([0, 1])
      // Scope is COPIED from the session row — never model-supplied.
      expect(todos.every((todo) => todo.sessionId === session.id)).toBe(true)
      expect(todos.every((todo) => todo.workspaceId === workspace.id)).toBe(true)
    })
  })

  it('IGNORES a model-supplied sessionId — the body has no such field', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const user = insertUser(db, makeUser())
      const workspace = seedWorkspace(db, user.id)
      const mine = insertChatSession(db, makeSession(user.id, workspace.id))
      const other = insertChatSession(db, makeSession(user.id, workspace.id))

      const res = await setTodos(
        app,
        { todos: [{ title: 'Sneaky', status: 'open' }], sessionId: other.id },
        { [TURN_SESSION_HEADER]: mine.id },
      )
      expect(res.status).toBe(200)
      const todos = (await res.json()) as SessionTodoResponse[]
      expect(todos.every((todo) => todo.sessionId === mine.id)).toBe(true)

      // The other session's dock is untouched.
      const otherList = (await (
        await app.request(`/todos?sessionId=${other.id}`)
      ).json()) as SessionTodoResponse[]
      expect(otherList).toEqual([])
    })
  })

  it('400s a turn with NO ambient session (a schedule fire / delegation tick)', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      insertUser(db, makeUser())

      const res = await setTodos(app, { todos: [{ title: 'Step', status: 'open' }] })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { message?: string }
      expect(body.message).toMatch(/no session/i)
    })
  })

  it('404s a session the caller does not own (identical to unknown)', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const attacker = insertUser(db, makeUser()) // resolved local user (first row)
      const victim = insertUser(db, makeUser())
      const victimWorkspace = seedWorkspace(db, victim.id)
      const victimSession = insertChatSession(db, makeSession(victim.id, victimWorkspace.id))
      expect(attacker.id).not.toBe(victim.id)

      const foreign = await setTodos(
        app,
        { todos: [{ title: 'Step', status: 'open' }] },
        { [TURN_SESSION_HEADER]: victimSession.id },
      )
      expect(foreign.status).toBe(404)

      const unknown = await setTodos(
        app,
        { todos: [{ title: 'Step', status: 'open' }] },
        { [TURN_SESSION_HEADER]: 'no-such-session' },
      )
      expect(unknown.status).toBe(404)
    })
  })

  it('accepts a workspace-less session (the global root) and an empty clearing list', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const user = insertUser(db, makeUser())
      const session = insertChatSession(db, makeSession(user.id, null))

      const created = (await (
        await setTodos(
          app,
          { todos: [{ title: 'Step', status: 'open' }] },
          { [TURN_SESSION_HEADER]: session.id },
        )
      ).json()) as SessionTodoResponse[]
      expect(created[0]!.workspaceId).toBeNull()

      const cleared = (await (
        await setTodos(app, { todos: [] }, { [TURN_SESSION_HEADER]: session.id })
      ).json()) as SessionTodoResponse[]
      expect(cleared).toEqual([])
    })
  })

  it('400s a malformed item so the model can correct it', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const user = insertUser(db, makeUser())
      const session = insertChatSession(db, makeSession(user.id, null))

      const res = await setTodos(
        app,
        { todos: [{ title: 'Step', status: 'started' }] },
        { [TURN_SESSION_HEADER]: session.id },
      )
      expect(res.status).toBe(400)
    })
  })
})

describe('the user door — GET / PATCH / DELETE', () => {
  it('lists one session in order and never another session\'s rows', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const user = insertUser(db, makeUser())
      insertSessionTodo(db, makeSessionTodo(user.id, 'session-a', { title: 'B', orderIndex: 1 }))
      insertSessionTodo(db, makeSessionTodo(user.id, 'session-a', { title: 'A', orderIndex: 0 }))
      insertSessionTodo(db, makeSessionTodo(user.id, 'session-b', { title: 'Elsewhere' }))

      const todos = (await (
        await app.request('/todos?sessionId=session-a')
      ).json()) as SessionTodoResponse[]
      expect(todos.map((todo) => todo.title)).toEqual(['A', 'B'])
    })
  })

  it('400s a list with no sessionId', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      insertUser(db, makeUser())
      expect((await app.request('/todos')).status).toBe(400)
    })
  })

  it('PATCH ticks a step done (stamping completedAt) and DELETE removes it', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const user = insertUser(db, makeUser())
      const todo = insertSessionTodo(db, makeSessionTodo(user.id, 'session-a'))

      const patched = (await (
        await app.request(`/todos/${todo.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'done' }),
        })
      ).json()) as SessionTodoResponse
      expect(patched.status).toBe('done')
      expect(patched.completedAt).not.toBeNull()

      const removed = await app.request(`/todos/${todo.id}`, { method: 'DELETE' })
      expect(removed.status).toBe(204)
      const rest = (await (
        await app.request('/todos?sessionId=session-a')
      ).json()) as SessionTodoResponse[]
      expect(rest).toEqual([])
    })
  })

  it('404s a PATCH/DELETE on another user\'s step', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      insertUser(db, makeUser()) // resolved local user (first row)
      const victim = insertUser(db, makeUser())
      const todo = insertSessionTodo(db, makeSessionTodo(victim.id, 'session-a'))

      const patched = await app.request(`/todos/${todo.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'done' }),
      })
      expect(patched.status).toBe(404)
      expect((await app.request(`/todos/${todo.id}`, { method: 'DELETE' })).status).toBe(404)
    })
  })
})
