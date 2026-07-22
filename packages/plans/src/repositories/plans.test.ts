import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { seedUserWorkspace, makePlan } from '../test-support.js'
import {
  insertPlan,
  findPlanById,
  updatePlan,
  hardDeletePlan,
  listPlansForWorkspace,
  listPlansForUser,
} from './index.js'

describe('plans repository', () => {
  it('inserts and finds a plan', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const plan = insertPlan(db, makePlan(userId, workspaceId))
      expect(findPlanById(db, plan.id)).toEqual(plan)
      expect(findPlanById(db, 'missing')).toBeNull()
    })
  })

  it('lists workspace plans without leaking global or foreign rows', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const other = seedUserWorkspace(db)
      insertPlan(db, makePlan(userId, workspaceId, { title: 'in workspace' }))
      insertPlan(db, makePlan(userId, null, { title: 'global' }))
      insertPlan(db, makePlan(other.userId, other.workspaceId, { title: 'foreign' }))

      const rows = listPlansForWorkspace(db, { userId, workspaceId })
      expect(rows.map((r) => r.title)).toEqual(['in workspace'])
    })
  })

  it('filters by planDate and orders newest day first', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      insertPlan(db, makePlan(userId, workspaceId, { title: 'earlier', planDate: '2026-07-21' }))
      insertPlan(db, makePlan(userId, workspaceId, { title: 'later', planDate: '2026-07-23' }))

      const all = listPlansForWorkspace(db, { userId, workspaceId })
      expect(all.map((r) => r.title)).toEqual(['later', 'earlier'])

      const day = listPlansForWorkspace(db, { userId, workspaceId, planDate: '2026-07-21' })
      expect(day.map((r) => r.title)).toEqual(['earlier'])
    })
  })

  it('lists user plans across workspace + global scopes with a status filter', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      insertPlan(db, makePlan(userId, workspaceId, { title: 'open one' }))
      insertPlan(db, makePlan(userId, null, { title: 'done one', status: 'done' }))

      expect(listPlansForUser(db, { userId })).toHaveLength(2)
      const done = listPlansForUser(db, { userId, status: 'done' })
      expect(done.map((r) => r.title)).toEqual(['done one'])
    })
  })

  it('updates and hard-deletes', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const plan = insertPlan(db, makePlan(userId, workspaceId))
      const updated = updatePlan(db, plan.id, { status: 'in-progress' })
      expect(updated.status).toBe('in-progress')
      hardDeletePlan(db, plan.id)
      expect(findPlanById(db, plan.id)).toBeNull()
    })
  })
})
