import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { NotFoundError, ValidationError } from '@vynel/errors'
import { seedUserWorkspace, makePlan, insertPlan } from '../test-support.js'
import { updatePlan } from './update-plan.js'
import { PLAN_COMPLETED, PLAN_UPDATED } from '../plans-events.js'

describe('updatePlan', () => {
  it('completing stamps completedAt and emits plan.completed (not plan.updated)', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const plan = insertPlan(db, makePlan(userId, workspaceId))

      const done = updatePlan(db, { planId: plan.id, userId, status: 'done' })
      expect(done.status).toBe('done')
      expect(done.completedAt).not.toBeNull()

      const completed = listOutboxEventsByType(db, PLAN_COMPLETED)
      expect(completed).toHaveLength(1)
      expect(completed[0]!.payload).toEqual({
        planId: plan.id,
        userId,
        workspaceId,
        planDate: plan.planDate,
        completedAt: done.completedAt!.toISOString(),
      })
      expect(listOutboxEventsByType(db, PLAN_UPDATED)).toHaveLength(0)
    })
  })

  it('reopening a done plan clears completedAt and emits plan.updated', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const plan = insertPlan(
        db,
        makePlan(userId, workspaceId, { status: 'done', completedAt: new Date() }),
      )

      const reopened = updatePlan(db, { planId: plan.id, userId, status: 'open' })
      expect(reopened.status).toBe('open')
      expect(reopened.completedAt).toBeNull()
      expect(listOutboxEventsByType(db, PLAN_UPDATED)).toHaveLength(1)
    })
  })

  it('patches title/detail/planDate and emits plan.updated', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const plan = insertPlan(db, makePlan(userId, workspaceId))

      const updated = updatePlan(db, {
        planId: plan.id,
        userId,
        title: 'New title',
        detail: 'More context',
        planDate: '2026-08-01',
      })
      expect(updated.title).toBe('New title')
      expect(updated.detail).toBe('More context')
      expect(updated.planDate).toBe('2026-08-01')
      expect(updated.status).toBe('open') // untouched
      expect(listOutboxEventsByType(db, PLAN_UPDATED)).toHaveLength(1)
    })
  })

  it('attaches and detaches a task via taskId', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const plan = insertPlan(db, makePlan(userId, workspaceId))

      const attached = updatePlan(db, { planId: plan.id, userId, taskId: 'task-1' })
      expect(attached.taskId).toBe('task-1')

      const detached = updatePlan(db, { planId: plan.id, userId, taskId: null })
      expect(detached.taskId).toBeNull()
    })
  })

  it('rejects a malformed planDate patch', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const plan = insertPlan(db, makePlan(userId, workspaceId))
      expect(() => updatePlan(db, { planId: plan.id, userId, planDate: 'next week' })).toThrow(
        ValidationError,
      )
    })
  })

  it('404s identically on missing and not-owned plans', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const other = seedUserWorkspace(db)
      const plan = insertPlan(db, makePlan(userId, workspaceId))

      expect(() => updatePlan(db, { planId: 'missing', userId, status: 'done' })).toThrow(
        NotFoundError,
      )
      expect(() =>
        updatePlan(db, { planId: plan.id, userId: other.userId, status: 'done' }),
      ).toThrow(NotFoundError)
    })
  })

  it('completing an already-done plan keeps the original completedAt', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const originalCompletedAt = new Date(Date.now() - 60_000)
      const plan = insertPlan(
        db,
        makePlan(userId, workspaceId, { status: 'done', completedAt: originalCompletedAt }),
      )

      const still = updatePlan(db, { planId: plan.id, userId, status: 'done' })
      expect(still.completedAt).toEqual(originalCompletedAt)
      // No transition happened → plan.updated, not a second plan.completed.
      expect(listOutboxEventsByType(db, PLAN_COMPLETED)).toHaveLength(0)
    })
  })
})
