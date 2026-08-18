import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { NotFoundError } from '@vynel/errors'
import { seedUserWorkspace, makeTask, insertTask } from '../test-support.js'
import { updateTask } from './update-task.js'
import { TASK_COMPLETED, TASK_UPDATED } from '../tasks-events.js'

describe('updateTask', () => {
  it('completing stamps completedAt and emits task.completed (not task.updated)', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const task = insertTask(db, makeTask(userId, workspaceId))

      const done = updateTask(db, { taskId: task.id, userId, status: 'done' })
      expect(done.status).toBe('done')
      expect(done.completedAt).not.toBeNull()

      const completed = listOutboxEventsByType(db, TASK_COMPLETED)
      expect(completed).toHaveLength(1)
      expect(completed[0]!.payload).toEqual({
        taskId: task.id,
        userId,
        workspaceId,
        completedAt: done.completedAt!.toISOString(),
      })
      expect(listOutboxEventsByType(db, TASK_UPDATED)).toHaveLength(0)
    })
  })

  it('reopening a done task clears completedAt and emits task.updated', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const task = insertTask(
        db,
        makeTask(userId, workspaceId, { status: 'done', completedAt: new Date() }),
      )

      const reopened = updateTask(db, { taskId: task.id, userId, status: 'open' })
      expect(reopened.status).toBe('open')
      expect(reopened.completedAt).toBeNull()
      expect(listOutboxEventsByType(db, TASK_UPDATED)).toHaveLength(1)
    })
  })

  it('patches title/detail and emits task.updated', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const task = insertTask(db, makeTask(userId, workspaceId))

      const updated = updateTask(db, {
        taskId: task.id,
        userId,
        title: 'New title',
        detail: 'More context',
      })
      expect(updated.title).toBe('New title')
      expect(updated.detail).toBe('More context')
      expect(updated.status).toBe('open') // untouched
      expect(listOutboxEventsByType(db, TASK_UPDATED)).toHaveLength(1)
    })
  })

  it('attaches and detaches a plan via planId', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const task = insertTask(db, makeTask(userId, workspaceId))

      const attached = updateTask(db, { taskId: task.id, userId, planId: 'plan-1' })
      expect(attached.planId).toBe('plan-1')

      const detached = updateTask(db, { taskId: task.id, userId, planId: null })
      expect(detached.planId).toBeNull()
    })
  })

  it('assigns and releases the working session via assignedSessionId', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const task = insertTask(db, makeTask(userId, workspaceId))

      const assigned = updateTask(db, {
        taskId: task.id,
        userId,
        status: 'in-progress',
        assignedSessionId: 'session-1',
      })
      expect(assigned.assignedSessionId).toBe('session-1')

      const released = updateTask(db, { taskId: task.id, userId, assignedSessionId: null })
      expect(released.assignedSessionId).toBeNull()
    })
  })

  it('404s identically on missing and not-owned tasks', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const other = seedUserWorkspace(db)
      const task = insertTask(db, makeTask(userId, workspaceId))

      expect(() => updateTask(db, { taskId: 'missing', userId, status: 'done' })).toThrow(
        NotFoundError,
      )
      expect(() =>
        updateTask(db, { taskId: task.id, userId: other.userId, status: 'done' }),
      ).toThrow(NotFoundError)
    })
  })

  it('completing an already-done task keeps the original completedAt', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const originalCompletedAt = new Date(Date.now() - 60_000)
      const task = insertTask(
        db,
        makeTask(userId, workspaceId, { status: 'done', completedAt: originalCompletedAt }),
      )

      const still = updateTask(db, { taskId: task.id, userId, status: 'done' })
      expect(still.completedAt).toEqual(originalCompletedAt)
      // No transition happened → task.updated, not a second task.completed.
      expect(listOutboxEventsByType(db, TASK_COMPLETED)).toHaveLength(0)
    })
  })
})
