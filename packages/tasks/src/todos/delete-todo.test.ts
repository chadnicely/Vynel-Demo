import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { insertUser } from '@vynel/db/repositories/users'
import { NotFoundError } from '@vynel/errors'
import { seedUserWorkspace } from '../test-support.js'
import { replaceSessionTodos } from './replace-session-todos.js'
import { listTodosForSession } from './list-todos-for-session.js'
import { deleteTodo } from './delete-todo.js'
import { SESSION_TODO_DELETED } from '../session-todos-events.js'

describe('deleteTodo', () => {
  it('hard-deletes the row and co-commits session-todo.deleted', async () => {
    await withTestDatabase(async (db) => {
      const { userId } = seedUserWorkspace(db)
      const rows = replaceSessionTodos(db, {
        userId,
        workspaceId: null,
        sessionId: 'session-1',
        todos: [
          { title: 'Step A', status: 'open' },
          { title: 'Step B', status: 'open' },
        ],
      })

      deleteTodo(db, { todoId: rows[0]!.id, userId })

      const remaining = listTodosForSession(db, { userId, sessionId: 'session-1' })
      expect(remaining.map((row) => row.title)).toEqual(['Step B'])

      const events = listOutboxEventsByType(db, SESSION_TODO_DELETED)
      expect(events).toHaveLength(1)
      expect(events[0]!.payload).toMatchObject({
        todoId: rows[0]!.id,
        userId,
        sessionId: 'session-1',
      })
    })
  })

  it('404s an unknown or foreign todo', async () => {
    await withTestDatabase(async (db) => {
      const { userId } = seedUserWorkspace(db)
      const now = new Date()
      const stranger = insertUser(db, {
        id: randomUUID(),
        displayName: 'Sam',
        emailAddress: null,
        locale: 'en-US',
        timezone: 'UTC',
        hasCompletedOnboarding: false,
        createdAt: now,
        updatedAt: now,
      })
      const [todo] = replaceSessionTodos(db, {
        userId,
        workspaceId: null,
        sessionId: 'session-1',
        todos: [{ title: 'Step A', status: 'open' }],
      })

      expect(() => deleteTodo(db, { todoId: 'nope', userId })).toThrow(NotFoundError)
      expect(() => deleteTodo(db, { todoId: todo!.id, userId: stranger.id })).toThrow(
        NotFoundError,
      )
    })
  })
})
