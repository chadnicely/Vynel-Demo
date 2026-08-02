import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { ValidationError } from '@vynel/errors'
import { seedUserWorkspace } from '../test-support.js'
import { replaceSessionTodos, MAX_TODOS_PER_SESSION, TODO_TITLE_MAX_LENGTH } from './replace-session-todos.js'
import { listTodosForSession } from './list-todos-for-session.js'
import { SESSION_TODOS_REPLACED } from '../session-todos-events.js'

describe('replaceSessionTodos', () => {
  it('inserts the list in array order and co-commits session-todos.replaced', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const rows = replaceSessionTodos(db, {
        userId,
        workspaceId,
        sessionId: 'session-1',
        todos: [
          { title: '  Read the brief  ', status: 'done' },
          { title: 'Draft the copy', status: 'in-progress' },
          { title: 'Send it', status: 'open' },
        ],
      })

      expect(rows.map((row) => row.title)).toEqual([
        'Read the brief', // trimmed
        'Draft the copy',
        'Send it',
      ])
      expect(rows.map((row) => row.orderIndex)).toEqual([0, 1, 2])
      expect(rows[0]!.completedAt).not.toBeNull() // 'done' stamps it
      expect(rows[1]!.completedAt).toBeNull()
      expect(rows[0]!.workspaceId).toBe(workspaceId)

      const events = listOutboxEventsByType(db, SESSION_TODOS_REPLACED)
      expect(events).toHaveLength(1)
      expect(events[0]!.payload).toMatchObject({
        userId,
        workspaceId,
        sessionId: 'session-1',
        todoCount: 3,
      })
    })
  })

  it('REPLACES wholesale — the previous list is gone, order comes from the new array', async () => {
    await withTestDatabase(async (db) => {
      const { userId } = seedUserWorkspace(db)
      const first = replaceSessionTodos(db, {
        userId,
        workspaceId: null,
        sessionId: 'session-1',
        todos: [
          { title: 'Step A', status: 'open' },
          { title: 'Step B', status: 'open' },
        ],
      })

      const second = replaceSessionTodos(db, {
        userId,
        workspaceId: null,
        sessionId: 'session-1',
        todos: [
          { title: 'Step B', status: 'done' },
          { title: 'Step C', status: 'in-progress' },
        ],
      })

      const stored = listTodosForSession(db, { userId, sessionId: 'session-1' })
      expect(stored.map((row) => row.title)).toEqual(['Step B', 'Step C'])
      expect(stored.map((row) => row.status)).toEqual(['done', 'in-progress'])
      // Wholesale replace: even a same-title step is a NEW row (module notes #1).
      expect(second.map((row) => row.id)).not.toEqual(
        expect.arrayContaining(first.map((row) => row.id)),
      )
    })
  })

  it('an empty list clears the session dock', async () => {
    await withTestDatabase(async (db) => {
      const { userId } = seedUserWorkspace(db)
      replaceSessionTodos(db, {
        userId,
        workspaceId: null,
        sessionId: 'session-1',
        todos: [{ title: 'Step A', status: 'open' }],
      })
      replaceSessionTodos(db, { userId, workspaceId: null, sessionId: 'session-1', todos: [] })

      expect(listTodosForSession(db, { userId, sessionId: 'session-1' })).toEqual([])
    })
  })

  it('touches only the target session', async () => {
    await withTestDatabase(async (db) => {
      const { userId } = seedUserWorkspace(db)
      replaceSessionTodos(db, {
        userId,
        workspaceId: null,
        sessionId: 'session-other',
        todos: [{ title: 'Elsewhere', status: 'open' }],
      })
      replaceSessionTodos(db, {
        userId,
        workspaceId: null,
        sessionId: 'session-1',
        todos: [{ title: 'Here', status: 'open' }],
      })

      const other = listTodosForSession(db, { userId, sessionId: 'session-other' })
      expect(other.map((row) => row.title)).toEqual(['Elsewhere'])
    })
  })

  it('rejects an empty title, an over-long title, and an over-long list', async () => {
    await withTestDatabase(async (db) => {
      const { userId } = seedUserWorkspace(db)
      const base = { userId, workspaceId: null, sessionId: 'session-1' } as const

      expect(() =>
        replaceSessionTodos(db, { ...base, todos: [{ title: '   ', status: 'open' }] }),
      ).toThrow(ValidationError)
      expect(() =>
        replaceSessionTodos(db, {
          ...base,
          todos: [{ title: 'x'.repeat(TODO_TITLE_MAX_LENGTH + 1), status: 'open' }],
        }),
      ).toThrow(ValidationError)
      expect(() =>
        replaceSessionTodos(db, {
          ...base,
          todos: Array.from({ length: MAX_TODOS_PER_SESSION + 1 }, (_, index) => ({
            title: `Step ${index}`,
            status: 'open' as const,
          })),
        }),
      ).toThrow(ValidationError)

      // A rejected call writes NOTHING — validation runs before the transaction.
      expect(listTodosForSession(db, { userId, sessionId: 'session-1' })).toEqual([])
    })
  })
})
