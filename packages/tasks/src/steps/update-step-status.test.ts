import { randomUUID } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { NotFoundError } from '@vynel/errors'
import { makeTask, makeTaskStep, seedUserWorkspace, insertTask, insertTaskStep } from '../test-support.js'
import { updateStepStatus } from './update-step-status.js'
import { TASK_STEP_UPDATED } from '../task-steps-events.js'

describe('updateStepStatus', () => {
  it('moves a step, stamps completedAt on done, clears it on reopen, and co-commits task-step.updated', async () => {
    await withTestDatabase(async (db) => {
      const { userId } = seedUserWorkspace(db)
      const task = insertTask(db, makeTask(userId, null))
      const step = insertTaskStep(db, makeTaskStep(userId, task.id))

      const done = updateStepStatus(db, { stepId: step.id, userId, status: 'done' })
      expect(done.status).toBe('done')
      expect(done.completedAt).not.toBeNull()

      const reopened = updateStepStatus(db, { stepId: step.id, userId, status: 'open' })
      expect(reopened.completedAt).toBeNull()

      const events = listOutboxEventsByType(db, TASK_STEP_UPDATED)
      expect(events).toHaveLength(2)
      expect(events[0]!.payload).toMatchObject({ stepId: step.id, taskId: task.id, status: 'done' })
    })
  })

  it('404s a missing step and a foreign-owned step identically', async () => {
    await withTestDatabase(async (db) => {
      const { userId } = seedUserWorkspace(db)
      const stranger = seedUserWorkspace(db)
      const strangersTask = insertTask(db, makeTask(stranger.userId, null))
      const strangersStep = insertTaskStep(db, makeTaskStep(stranger.userId, strangersTask.id))

      expect(() =>
        updateStepStatus(db, { stepId: randomUUID(), userId, status: 'done' }),
      ).toThrow(NotFoundError)
      expect(() =>
        updateStepStatus(db, { stepId: strangersStep.id, userId, status: 'done' }),
      ).toThrow(NotFoundError)
    })
  })
})
