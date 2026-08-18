import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { makeTask, makeTaskStep, seedUserWorkspace, insertTask } from '../test-support.js'
import {
  insertTaskStep,
  listTaskSteps,
  findTaskStepById,
  updateTaskStep,
  hardDeleteTaskStep,
  hardDeleteTaskStepsForTask,
} from './task-steps.js'

describe('task-steps repository', () => {
  it("lists one task's rows in orderIndex order", async () => {
    await withTestDatabase(async (db) => {
      const { userId } = seedUserWorkspace(db)
      const taskA = insertTask(db, makeTask(userId, null))
      const taskB = insertTask(db, makeTask(userId, null))
      insertTaskStep(db, makeTaskStep(userId, taskA.id, { title: 'Third', orderIndex: 2 }))
      insertTaskStep(db, makeTaskStep(userId, taskA.id, { title: 'First', orderIndex: 0 }))
      insertTaskStep(db, makeTaskStep(userId, taskA.id, { title: 'Second', orderIndex: 1 }))
      insertTaskStep(db, makeTaskStep(userId, taskB.id, { title: 'Other task' }))

      const rows = listTaskSteps(db, { userId, taskId: taskA.id })
      expect(rows.map((row) => row.title)).toEqual(['First', 'Second', 'Third'])
    })
  })

  it('finds, patches and hard-deletes a single row', async () => {
    await withTestDatabase(async (db) => {
      const { userId } = seedUserWorkspace(db)
      const task = insertTask(db, makeTask(userId, null))
      const row = insertTaskStep(db, makeTaskStep(userId, task.id))

      expect(findTaskStepById(db, row.id)?.title).toBe(row.title)
      expect(updateTaskStep(db, row.id, { status: 'done' }).status).toBe('done')

      hardDeleteTaskStep(db, row.id)
      expect(findTaskStepById(db, row.id)).toBeNull()
    })
  })

  it('clears one task only', async () => {
    await withTestDatabase(async (db) => {
      const { userId } = seedUserWorkspace(db)
      const taskA = insertTask(db, makeTask(userId, null))
      const taskB = insertTask(db, makeTask(userId, null))
      insertTaskStep(db, makeTaskStep(userId, taskA.id))
      insertTaskStep(db, makeTaskStep(userId, taskB.id))

      hardDeleteTaskStepsForTask(db, { userId, taskId: taskA.id })

      expect(listTaskSteps(db, { userId, taskId: taskA.id })).toEqual([])
      expect(listTaskSteps(db, { userId, taskId: taskB.id })).toHaveLength(1)
    })
  })
})
