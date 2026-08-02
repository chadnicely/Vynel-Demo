import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { makeSessionTodo, seedUserWorkspace } from '../test-support.js'
import {
  insertSessionTodo,
  listSessionTodos,
  findSessionTodoById,
  updateSessionTodo,
  hardDeleteSessionTodo,
  hardDeleteSessionTodosForSession,
} from './session-todos.js'

describe('session-todos repository', () => {
  it('lists one session\'s rows in orderIndex order', async () => {
    await withTestDatabase(async (db) => {
      const { userId } = seedUserWorkspace(db)
      insertSessionTodo(db, makeSessionTodo(userId, 'session-1', { title: 'Third', orderIndex: 2 }))
      insertSessionTodo(db, makeSessionTodo(userId, 'session-1', { title: 'First', orderIndex: 0 }))
      insertSessionTodo(db, makeSessionTodo(userId, 'session-1', { title: 'Second', orderIndex: 1 }))
      insertSessionTodo(db, makeSessionTodo(userId, 'session-2', { title: 'Other session' }))

      const rows = listSessionTodos(db, { userId, sessionId: 'session-1' })
      expect(rows.map((row) => row.title)).toEqual(['First', 'Second', 'Third'])
    })
  })

  it('finds, patches and hard-deletes a single row', async () => {
    await withTestDatabase(async (db) => {
      const { userId } = seedUserWorkspace(db)
      const row = insertSessionTodo(db, makeSessionTodo(userId, 'session-1'))

      expect(findSessionTodoById(db, row.id)?.title).toBe(row.title)
      expect(updateSessionTodo(db, row.id, { status: 'done' }).status).toBe('done')

      hardDeleteSessionTodo(db, row.id)
      expect(findSessionTodoById(db, row.id)).toBeNull()
    })
  })

  it('clears one session only', async () => {
    await withTestDatabase(async (db) => {
      const { userId } = seedUserWorkspace(db)
      insertSessionTodo(db, makeSessionTodo(userId, 'session-1'))
      insertSessionTodo(db, makeSessionTodo(userId, 'session-2'))

      hardDeleteSessionTodosForSession(db, { userId, sessionId: 'session-1' })

      expect(listSessionTodos(db, { userId, sessionId: 'session-1' })).toEqual([])
      expect(listSessionTodos(db, { userId, sessionId: 'session-2' })).toHaveLength(1)
    })
  })
})
