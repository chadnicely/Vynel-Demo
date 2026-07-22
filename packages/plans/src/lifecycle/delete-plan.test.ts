import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { NotFoundError } from '@vynel/errors'
import { seedUserWorkspace, makePlan, insertPlan } from '../test-support.js'
import { findPlanById } from '../repositories/index.js'
import { deletePlan } from './delete-plan.js'
import { PLAN_DELETED } from '../plans-events.js'

describe('deletePlan', () => {
  it('hard-deletes and co-commits plan.deleted', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const plan = insertPlan(db, makePlan(userId, workspaceId))

      deletePlan(db, { planId: plan.id, userId })
      expect(findPlanById(db, plan.id)).toBeNull()

      const events = listOutboxEventsByType(db, PLAN_DELETED)
      expect(events).toHaveLength(1)
      expect(events[0]!.payload).toMatchObject({ planId: plan.id, userId, workspaceId })
    })
  })

  it('404s identically on missing and not-owned plans', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const other = seedUserWorkspace(db)
      const plan = insertPlan(db, makePlan(userId, workspaceId))

      expect(() => deletePlan(db, { planId: 'missing', userId })).toThrow(NotFoundError)
      expect(() => deletePlan(db, { planId: plan.id, userId: other.userId })).toThrow(NotFoundError)
      expect(findPlanById(db, plan.id)).not.toBeNull()
    })
  })
})
