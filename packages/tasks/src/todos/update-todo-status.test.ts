import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { NotFoundError } from '@vynel/errors'
import { insertUser } from '@vynel/db/repositories/users'
import { randomUUID } from 'node:crypto'
import { seedUserWorkspace } from '../test-support.js'
import { replaceSessionTodos } from './replace-session-todos.js'
import { updateTodoStatus } from './update-todo-status.js'
import { SESSION_TODO_UPDATED } from '../session-todos-events.js'

describe('updateTodoStatus', () => {
  it('stamps completedAt on → done and clears it on reopen, co-committing the event', async () => {
    await withTestDatabase(async (db) => {
      const { userId } = seedUserWorkspace(db)
      const [todo] = replaceSessionTodos(db, {
        userId,
        workspaceId: null,
        sessionId: 'session-1',
        todos: [{ title: 'Step A', status: 'open' }],
      })

      const done = updateTodoStatus(db, { todoId: todo!.id, userId, status: 'done' })
      expect(done.status).toBe('done')
      expect(done.completedAt).not.toBeNull()

      const reopened = updateTodoStatus(db, { todoId: todo!.id, userId, status: 'open' })
      expect(reopened.completedAt).toBeNull()

      const events = listOutboxEventsByType(db, SESSION_TODO_UPDATED)
      expect(events).toHaveLength(2)
      expect(events[0]!.payload).toMatchObject({
        todoId: todo!.id,
        userId,
        sessionId: 'session-1',
        status: 'done',
      })
    })
  })

  it('404s a todo owned by someone else (same shape as not-found)', async () => {
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

      expect(() =>
        updateTodoStatus(db, { todoId: todo!.id, userId: stranger.id, status: 'done' }),
      ).toThrow(NotFoundError)
      expect(() =>
        updateTodoStatus(db, { todoId: 'no-such-todo', userId, status: 'done' }),
      ).toThrow(NotFoundError)
    })
  })
})
