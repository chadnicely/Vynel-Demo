import { randomUUID } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { NotFoundError, ValidationError } from '@vynel/errors'
import { makeTask, seedUserWorkspace, insertTask } from '../test-support.js'
import { findTaskById } from '../repositories/tasks.js'
import {
  replaceTaskSteps,
  MAX_STEPS_PER_TASK,
  STEP_TITLE_MAX_LENGTH,
} from './replace-task-steps.js'
import { listStepsForTask } from './list-steps-for-task.js'
import { TASK_STEPS_REPLACED } from '../task-steps-events.js'

describe('replaceTaskSteps', () => {
  it('inserts the list in array order, derives workspaceId from the task, and co-commits task-steps.replaced', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const task = insertTask(db, makeTask(userId, workspaceId))
      const rows = replaceTaskSteps(db, {
        userId,
        taskId: task.id,
        planId: 'plan-1',
        sessionId: 'session-1',
        steps: [
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
      // The full linkage rides every row — scope copied from the task, never
      // caller-supplied.
      expect(rows[0]!.workspaceId).toBe(workspaceId)
      expect(rows[0]!.taskId).toBe(task.id)
      expect(rows[0]!.planId).toBe('plan-1')
      expect(rows[0]!.sessionId).toBe('session-1')

      const events = listOutboxEventsByType(db, TASK_STEPS_REPLACED)
      expect(events).toHaveLength(1)
      expect(events[0]!.payload).toMatchObject({
        userId,
        workspaceId,
        taskId: task.id,
        planId: 'plan-1',
        sessionId: 'session-1',
        stepCount: 3,
      })
    })
  })

  it('re-stamps the WORKING session on takeover — whoever writes the steps is working the task', async () => {
    await withTestDatabase(async (db) => {
      const { userId } = seedUserWorkspace(db)
      const task = insertTask(db, makeTask(userId, null, { assignedSessionId: 'session-first' }))

      replaceTaskSteps(db, {
        userId,
        taskId: task.id,
        sessionId: 'session-takeover',
        steps: [{ title: 'Step', status: 'open' }],
      })
      expect(findTaskById(db, task.id)?.assignedSessionId).toBe('session-takeover')

      // A session-less write (a background turn with no ambient identity)
      // leaves the assignment untouched.
      replaceTaskSteps(db, { userId, taskId: task.id, steps: [] })
      expect(findTaskById(db, task.id)?.assignedSessionId).toBe('session-takeover')
    })
  })

  it('404s a missing task and a foreign-owned task identically', async () => {
    await withTestDatabase(async (db) => {
      const { userId } = seedUserWorkspace(db)
      const stranger = seedUserWorkspace(db)
      const strangersTask = insertTask(db, makeTask(stranger.userId, null))

      expect(() =>
        replaceTaskSteps(db, { userId, taskId: randomUUID(), steps: [] }),
      ).toThrow(NotFoundError)
      expect(() =>
        replaceTaskSteps(db, { userId, taskId: strangersTask.id, steps: [] }),
      ).toThrow(NotFoundError)
    })
  })

  it('REPLACES wholesale — the previous list is gone, order comes from the new array', async () => {
    await withTestDatabase(async (db) => {
      const { userId } = seedUserWorkspace(db)
      const task = insertTask(db, makeTask(userId, null))
      const first = replaceTaskSteps(db, {
        userId,
        taskId: task.id,
        steps: [
          { title: 'Step A', status: 'open' },
          { title: 'Step B', status: 'open' },
        ],
      })

      const second = replaceTaskSteps(db, {
        userId,
        taskId: task.id,
        steps: [
          { title: 'Step B', status: 'done' },
          { title: 'Step C', status: 'in-progress' },
        ],
      })

      const stored = listStepsForTask(db, { userId, taskId: task.id })
      expect(stored.map((row) => row.title)).toEqual(['Step B', 'Step C'])
      expect(stored.map((row) => row.status)).toEqual(['done', 'in-progress'])
      // Wholesale replace: even a same-title step is a NEW row.
      expect(second.map((row) => row.id)).not.toEqual(
        expect.arrayContaining(first.map((row) => row.id)),
      )
    })
  })

  it('an empty list clears the task, touching only the target task', async () => {
    await withTestDatabase(async (db) => {
      const { userId } = seedUserWorkspace(db)
      const taskA = insertTask(db, makeTask(userId, null))
      const taskB = insertTask(db, makeTask(userId, null))
      replaceTaskSteps(db, {
        userId,
        taskId: taskA.id,
        steps: [{ title: 'Step A', status: 'open' }],
      })
      replaceTaskSteps(db, {
        userId,
        taskId: taskB.id,
        steps: [{ title: 'Elsewhere', status: 'open' }],
      })

      replaceTaskSteps(db, { userId, taskId: taskA.id, steps: [] })

      expect(listStepsForTask(db, { userId, taskId: taskA.id })).toEqual([])
      expect(
        listStepsForTask(db, { userId, taskId: taskB.id }).map((row) => row.title),
      ).toEqual(['Elsewhere'])
    })
  })

  it('rejects an empty title, an over-long title, and an over-long list', async () => {
    await withTestDatabase(async (db) => {
      const { userId } = seedUserWorkspace(db)
      const task = insertTask(db, makeTask(userId, null))
      const base = { userId, taskId: task.id } as const

      expect(() =>
        replaceTaskSteps(db, { ...base, steps: [{ title: '   ', status: 'open' }] }),
      ).toThrow(ValidationError)
      expect(() =>
        replaceTaskSteps(db, {
          ...base,
          steps: [{ title: 'x'.repeat(STEP_TITLE_MAX_LENGTH + 1), status: 'open' }],
        }),
      ).toThrow(ValidationError)
      expect(() =>
        replaceTaskSteps(db, {
          ...base,
          steps: Array.from({ length: MAX_STEPS_PER_TASK + 1 }, (_, index) => ({
            title: `Step ${index}`,
            status: 'open' as const,
          })),
        }),
      ).toThrow(ValidationError)

      // A rejected call writes NOTHING — validation runs before the transaction.
      expect(listStepsForTask(db, { userId, taskId: task.id })).toEqual([])
    })
  })
})
