import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { seedUserWorkspace, makePhase } from '../test-support.js'
import {
  listPhasesForWorkspace,
  findPhaseById,
  findMaxOrderIndexForWorkspace,
  insertPhase,
  updatePhase,
  hardDeletePhase,
} from './phases.js'

describe('phases repository', () => {
  it('inserts and reads back a phase', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const inserted = insertPhase(db, makePhase(userId, workspaceId))
      expect(findPhaseById(db, inserted.id)).toEqual(inserted)
    })
  })

  it('lists in build order (orderIndex asc), scoped to the owner + workspace', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const other = seedUserWorkspace(db)
      insertPhase(db, makePhase(userId, workspaceId, { title: 'Second', orderIndex: 1 }))
      insertPhase(db, makePhase(userId, workspaceId, { title: 'First', orderIndex: 0 }))
      insertPhase(db, makePhase(other.userId, other.workspaceId, { title: 'Elsewhere' }))

      const listed = listPhasesForWorkspace(db, { userId, workspaceId })
      expect(listed.map((p) => p.title)).toEqual(['First', 'Second'])
    })
  })

  it('filters by status', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      insertPhase(db, makePhase(userId, workspaceId, { orderIndex: 0 }))
      insertPhase(db, makePhase(userId, workspaceId, { orderIndex: 1, status: 'done' }))

      const done = listPhasesForWorkspace(db, { userId, workspaceId, status: 'done' })
      expect(done).toHaveLength(1)
      expect(done[0]!.status).toBe('done')
    })
  })

  it('findMaxOrderIndexForWorkspace: null when empty, max otherwise', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      expect(findMaxOrderIndexForWorkspace(db, workspaceId)).toBeNull()
      insertPhase(db, makePhase(userId, workspaceId, { orderIndex: 0 }))
      insertPhase(db, makePhase(userId, workspaceId, { orderIndex: 4 }))
      expect(findMaxOrderIndexForWorkspace(db, workspaceId)).toBe(4)
    })
  })

  it('updates a patch and hard-deletes', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const inserted = insertPhase(db, makePhase(userId, workspaceId))

      const updated = updatePhase(db, inserted.id, { status: 'in-progress' })
      expect(updated.status).toBe('in-progress')

      hardDeletePhase(db, inserted.id)
      expect(findPhaseById(db, inserted.id)).toBeNull()
    })
  })
})
