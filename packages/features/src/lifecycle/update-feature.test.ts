import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { NotFoundError } from '@vynel/errors'
import { seedUserWorkspace, insertFeature, makeFeature } from '../test-support.js'
import { updateFeature } from './update-feature.js'
import { FEATURE_COMPLETED, FEATURE_UPDATED } from '../features-events.js'

describe('updateFeature', () => {
  it('patches title, description and phase link; emits feature.updated', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const feature = insertFeature(db, makeFeature(userId, workspaceId))

      const updated = updateFeature(db, {
        featureId: feature.id,
        userId,
        title: 'Online ordering v2',
        description: 'A reshaped write-up.',
        phaseId: 'phase-2',
      })

      expect(updated.title).toBe('Online ordering v2')
      expect(updated.description).toBe('A reshaped write-up.')
      expect(updated.phaseId).toBe('phase-2')
      expect(listOutboxEventsByType(db, FEATURE_UPDATED)).toHaveLength(1)
    })
  })

  it('phaseId null unlinks the feature from its phase', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const feature = insertFeature(db, makeFeature(userId, workspaceId, { phaseId: 'phase-1' }))
      const updated = updateFeature(db, { featureId: feature.id, userId, phaseId: null })
      expect(updated.phaseId).toBeNull()
    })
  })

  it('completing stamps completedAt and emits feature.completed; reopening clears it', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const feature = insertFeature(db, makeFeature(userId, workspaceId))

      const done = updateFeature(db, { featureId: feature.id, userId, status: 'done' })
      expect(done.completedAt).not.toBeNull()
      expect(listOutboxEventsByType(db, FEATURE_COMPLETED)).toHaveLength(1)

      const reopened = updateFeature(db, { featureId: feature.id, userId, status: 'open' })
      expect(reopened.completedAt).toBeNull()
      expect(listOutboxEventsByType(db, FEATURE_UPDATED)).toHaveLength(1)
    })
  })

  it('404s for a missing feature and for another user (same error)', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const stranger = seedUserWorkspace(db)
      const feature = insertFeature(db, makeFeature(userId, workspaceId))

      expect(() => updateFeature(db, { featureId: 'missing', userId, status: 'done' })).toThrow(
        NotFoundError,
      )
      expect(() =>
        updateFeature(db, { featureId: feature.id, userId: stranger.userId, status: 'done' }),
      ).toThrow(NotFoundError)
    })
  })
})
