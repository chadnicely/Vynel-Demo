import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { NotFoundError } from '@vynel/errors'
import { seedUserWorkspace, makeTask, insertTask } from '../test-support.js'
import { findTaskById } from '../repositories/index.js'
import { deleteTask } from './delete-task.js'
import { TASK_DELETED } from '../tasks-events.js'

describe('deleteTask', () => {
  it('hard-deletes and co-commits task.deleted', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const task = insertTask(db, makeTask(userId, workspaceId))

      deleteTask(db, { taskId: task.id, userId })
      expect(findTaskById(db, task.id)).toBeNull()

      const events = listOutboxEventsByType(db, TASK_DELETED)
      expect(events).toHaveLength(1)
      expect(events[0]!.payload).toMatchObject({ taskId: task.id, userId, workspaceId })
    })
  })

  it('404s identically on missing and not-owned tasks', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const other = seedUserWorkspace(db)
      const task = insertTask(db, makeTask(userId, workspaceId))

      expect(() => deleteTask(db, { taskId: 'missing', userId })).toThrow(NotFoundError)
      expect(() => deleteTask(db, { taskId: task.id, userId: other.userId })).toThrow(NotFoundError)
      expect(findTaskById(db, task.id)).not.toBeNull()
    })
  })
})
