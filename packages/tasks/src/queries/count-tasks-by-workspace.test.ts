// Tests for countTasksByWorkspace — done/total per workspace in one grouped
// read, the global (null-workspace) bucket included, tenant-scoped.

import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { seedUserWorkspace } from '../test-support.js'
import { createTask } from '../lifecycle/create-task.js'
import { updateTask } from '../lifecycle/update-task.js'
import { countTasksByWorkspace } from './count-tasks-by-workspace.js'

describe('countTasksByWorkspace', () => {
  it('rolls up done/total per workspace, global bucket keyed null', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)

      const first = createTask(db, { userId, workspaceId, title: 'One', source: 'assistant' })
      createTask(db, { userId, workspaceId, title: 'Two', source: 'assistant' })
      createTask(db, { userId, workspaceId: null, title: 'Global chore', source: 'user' })
      updateTask(db, { userId, taskId: first.id, status: 'done' })

      const counts = countTasksByWorkspace(db, { userId })
      const byKey = new Map(counts.map((row) => [row.workspaceId, row]))

      expect(byKey.get(workspaceId)).toMatchObject({ total: 2, done: 1 })
      expect(byKey.get(null)).toMatchObject({ total: 1, done: 0 })
    })
  })

  it('is tenant-scoped — another user sees nothing', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      createTask(db, { userId, workspaceId, title: 'Mine', source: 'user' })

      const stranger = {
        id: crypto.randomUUID(),
        displayName: 'Stranger',
        emailAddress: null,
        locale: 'en-US',
        timezone: 'UTC',
        hasCompletedOnboarding: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      insertUser(db, stranger)
      expect(countTasksByWorkspace(db, { userId: stranger.id })).toHaveLength(0)
    })
  })
})
