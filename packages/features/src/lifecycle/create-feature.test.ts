import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { ValidationError } from '@vynel/errors'
import { seedUserWorkspace } from '../test-support.js'
import {
  createFeature,
  FEATURE_TITLE_MAX_LENGTH,
  FEATURE_DESCRIPTION_MAX_LENGTH,
} from './create-feature.js'
import { FEATURE_CREATED } from '../features-events.js'

describe('createFeature', () => {
  it('inserts an open feature and co-commits feature.created', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const feature = createFeature(db, {
        userId,
        workspaceId,
        title: '  Online ordering  ',
        description: '  Customers browse the menu and pay online.  ',
        phaseId: 'phase-1',
        sessionId: 'session-1',
      })

      expect(feature.title).toBe('Online ordering') // trimmed
      expect(feature.description).toBe('Customers browse the menu and pay online.') // trimmed
      expect(feature.status).toBe('open')
      expect(feature.phaseId).toBe('phase-1')
      expect(feature.completedAt).toBeNull()
      expect(feature.sessionId).toBe('session-1')

      const events = listOutboxEventsByType(db, FEATURE_CREATED)
      expect(events).toHaveLength(1)
      expect(events[0]!.payload).toEqual({
        featureId: feature.id,
        userId,
        workspaceId,
        phaseId: 'phase-1',
        createdAt: feature.createdAt.toISOString(),
      })
    })
  })

  it('creates unlinked (null phaseId) when no phase is given', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const feature = createFeature(db, {
        userId,
        workspaceId,
        title: 'Loyalty points',
        description: 'Repeat customers collect points.',
      })
      expect(feature.phaseId).toBeNull()
    })
  })

  it('rejects an empty or over-long title', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      expect(() =>
        createFeature(db, { userId, workspaceId, title: '   ', description: 'Body.' }),
      ).toThrow(ValidationError)
      expect(() =>
        createFeature(db, {
          userId,
          workspaceId,
          title: 'x'.repeat(FEATURE_TITLE_MAX_LENGTH + 1),
          description: 'Body.',
        }),
      ).toThrow(ValidationError)
    })
  })

  it('rejects an empty or over-long description', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      expect(() =>
        createFeature(db, { userId, workspaceId, title: 'Ordering', description: '   ' }),
      ).toThrow(ValidationError)
      expect(() =>
        createFeature(db, {
          userId,
          workspaceId,
          title: 'Ordering',
          description: 'x'.repeat(FEATURE_DESCRIPTION_MAX_LENGTH + 1),
        }),
      ).toThrow(ValidationError)
    })
  })
})
