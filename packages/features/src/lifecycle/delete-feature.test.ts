import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { NotFoundError } from '@vynel/errors'
import { seedUserWorkspace, insertFeature, makeFeature } from '../test-support.js'
import { deleteFeature } from './delete-feature.js'
import { getFeatureOrThrow } from '../queries/list-features.js'
import { FEATURE_DELETED } from '../features-events.js'

describe('deleteFeature', () => {
  it('hard-deletes and co-commits feature.deleted', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const feature = insertFeature(db, makeFeature(userId, workspaceId))

      deleteFeature(db, { featureId: feature.id, userId })

      expect(() => getFeatureOrThrow(db, { featureId: feature.id, userId })).toThrow(NotFoundError)
      const events = listOutboxEventsByType(db, FEATURE_DELETED)
      expect(events).toHaveLength(1)
      expect(events[0]!.payload).toMatchObject({ featureId: feature.id, userId, workspaceId })
    })
  })

  it("404s for a missing feature and for another user's feature (same error)", async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const stranger = seedUserWorkspace(db)
      const feature = insertFeature(db, makeFeature(userId, workspaceId))

      expect(() => deleteFeature(db, { featureId: 'missing', userId })).toThrow(NotFoundError)
      expect(() => deleteFeature(db, { featureId: feature.id, userId: stranger.userId })).toThrow(
        NotFoundError,
      )
      // Still there — the stranger's attempt must not delete.
      expect(getFeatureOrThrow(db, { featureId: feature.id, userId }).id).toBe(feature.id)
    })
  })
})
