import { randomUUID } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { NotFoundError } from '@vynel/errors'
import { makeTask, makeTaskStep, seedUserWorkspace, insertTask, insertTaskStep } from '../test-support.js'
import { deleteStep } from './delete-step.js'
import { listStepsForTask } from './list-steps-for-task.js'
import { TASK_STEP_DELETED } from '../task-steps-events.js'

describe('deleteStep', () => {
  it('hard-deletes one step and co-commits task-step.deleted', async () => {
    await withTestDatabase(async (db) => {
      const { userId } = seedUserWorkspace(db)
      const task = insertTask(db, makeTask(userId, null))
      const step = insertTaskStep(db, makeTaskStep(userId, task.id))
      const kept = insertTaskStep(db, makeTaskStep(userId, task.id, { orderIndex: 1 }))

      deleteStep(db, { stepId: step.id, userId })

      expect(listStepsForTask(db, { userId, taskId: task.id }).map((row) => row.id)).toEqual([
        kept.id,
      ])
      const events = listOutboxEventsByType(db, TASK_STEP_DELETED)
      expect(events).toHaveLength(1)
      expect(events[0]!.payload).toMatchObject({ stepId: step.id, taskId: task.id })
    })
  })

  it('404s a missing step and a foreign-owned step identically', async () => {
    await withTestDatabase(async (db) => {
      const { userId } = seedUserWorkspace(db)
      const stranger = seedUserWorkspace(db)
      const strangersTask = insertTask(db, makeTask(stranger.userId, null))
      const strangersStep = insertTaskStep(db, makeTaskStep(stranger.userId, strangersTask.id))

      expect(() => deleteStep(db, { stepId: randomUUID(), userId })).toThrow(NotFoundError)
      expect(() => deleteStep(db, { stepId: strangersStep.id, userId })).toThrow(NotFoundError)
    })
  })
})
