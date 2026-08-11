import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { seedUserWorkspace, makeFeature } from '../test-support.js'
import {
  listFeaturesForWorkspace,
  findFeatureById,
  insertFeature,
  updateFeature,
  hardDeleteFeature,
} from './features.js'

describe('features repository', () => {
  it('inserts and reads back a feature', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const inserted = insertFeature(db, makeFeature(userId, workspaceId))
      expect(findFeatureById(db, inserted.id)).toEqual(inserted)
    })
  })

  it('lists scoped to the owner + workspace, filterable by status and phaseId', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const other = seedUserWorkspace(db)
      insertFeature(db, makeFeature(userId, workspaceId, { title: 'Ordering' }))
      insertFeature(
        db,
        makeFeature(userId, workspaceId, { title: 'Loyalty', phaseId: 'phase-1', status: 'done' }),
      )
      insertFeature(db, makeFeature(other.userId, other.workspaceId, { title: 'Elsewhere' }))

      const all = listFeaturesForWorkspace(db, { userId, workspaceId })
      expect(all.map((f) => f.title).sort()).toEqual(['Loyalty', 'Ordering'])

      const inPhase = listFeaturesForWorkspace(db, { userId, workspaceId, phaseId: 'phase-1' })
      expect(inPhase.map((f) => f.title)).toEqual(['Loyalty'])

      const done = listFeaturesForWorkspace(db, { userId, workspaceId, status: 'done' })
      expect(done.map((f) => f.title)).toEqual(['Loyalty'])
    })
  })

  it('updates a patch and hard-deletes', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const inserted = insertFeature(db, makeFeature(userId, workspaceId))

      const updated = updateFeature(db, inserted.id, { phaseId: 'phase-9' })
      expect(updated.phaseId).toBe('phase-9')

      hardDeleteFeature(db, inserted.id)
      expect(findFeatureById(db, inserted.id)).toBeNull()
    })
  })
})
