import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { seedUserWorkspace, makeTask } from '../test-support.js'
import {
  insertTask,
  findTaskById,
  updateTask,
  hardDeleteTask,
  listTasksForWorkspace,
  listTasksForUser,
} from './index.js'

describe('tasks repository', () => {
  it('inserts and finds a task', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const task = insertTask(db, makeTask(userId, workspaceId))
      expect(findTaskById(db, task.id)).toEqual(task)
      expect(findTaskById(db, 'missing')).toBeNull()
    })
  })

  it('lists workspace tasks without leaking global or foreign rows', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const other = seedUserWorkspace(db)
      insertTask(db, makeTask(userId, workspaceId, { title: 'in workspace' }))
      insertTask(db, makeTask(userId, null, { title: 'global' }))
      insertTask(db, makeTask(other.userId, other.workspaceId, { title: 'foreign' }))

      const rows = listTasksForWorkspace(db, { userId, workspaceId })
      expect(rows.map((r) => r.title)).toEqual(['in workspace'])
    })
  })

  it('lists user tasks across workspace + global scopes with a status filter', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      insertTask(db, makeTask(userId, workspaceId, { title: 'open one' }))
      insertTask(db, makeTask(userId, null, { title: 'done one', status: 'done' }))

      expect(listTasksForUser(db, { userId })).toHaveLength(2)
      const done = listTasksForUser(db, { userId, status: 'done' })
      expect(done.map((r) => r.title)).toEqual(['done one'])
    })
  })

  it('updates and hard-deletes', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const task = insertTask(db, makeTask(userId, workspaceId))
      const updated = updateTask(db, task.id, { status: 'in-progress' })
      expect(updated.status).toBe('in-progress')
      hardDeleteTask(db, task.id)
      expect(findTaskById(db, task.id)).toBeNull()
    })
  })
})
