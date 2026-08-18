import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { ValidationError } from '@vynel/errors'
import { seedUserWorkspace } from '../test-support.js'
import { createTask, TASK_TITLE_MAX_LENGTH } from './create-task.js'
import { TASK_CREATED } from '../tasks-events.js'

describe('createTask', () => {
  it('inserts an open task and co-commits task.created', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const task = createTask(db, {
        userId,
        workspaceId,
        title: '  Draft the newsletter  ',
        detail: 'Cover the spring menu.',
        source: 'assistant',
        sessionId: 'session-1',
      })

      expect(task.title).toBe('Draft the newsletter') // trimmed
      expect(task.status).toBe('open')
      expect(task.completedAt).toBeNull()
      expect(task.sessionId).toBe('session-1')

      const events = listOutboxEventsByType(db, TASK_CREATED)
      expect(events).toHaveLength(1)
      expect(events[0]!.payload).toEqual({
        taskId: task.id,
        userId,
        workspaceId,
        title: task.title,
        source: 'assistant',
        createdAt: task.createdAt.toISOString(),
      })
    })
  })

  it('stores the loose planId ref when given', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const task = createTask(db, {
        userId,
        workspaceId,
        title: 'Planned work',
        source: 'assistant',
        planId: 'plan-1',
      })
      expect(task.planId).toBe('plan-1')
    })
  })

  it('creates a GLOBAL task (null workspaceId)', async () => {
    await withTestDatabase(async (db) => {
      const { userId } = seedUserWorkspace(db)
      const task = createTask(db, { userId, workspaceId: null, title: 'Global chore', source: 'user' })
      expect(task.workspaceId).toBeNull()
    })
  })

  it('rejects an empty title and an over-long title', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      expect(() =>
        createTask(db, { userId, workspaceId, title: '   ', source: 'user' }),
      ).toThrow(ValidationError)
      expect(() =>
        createTask(db, {
          userId,
          workspaceId,
          title: 'x'.repeat(TASK_TITLE_MAX_LENGTH + 1),
          source: 'user',
        }),
      ).toThrow(ValidationError)
    })
  })
})
