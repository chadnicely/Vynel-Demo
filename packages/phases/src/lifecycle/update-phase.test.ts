import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { NotFoundError, ValidationError } from '@vynel/errors'
import { seedUserWorkspace, insertPhase, makePhase } from '../test-support.js'
import { updatePhase } from './update-phase.js'
import { PHASE_COMPLETED, PHASE_UPDATED } from '../phases-events.js'

describe('updatePhase', () => {
  it('patches title, description and orderIndex; emits phase.updated', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const phase = insertPhase(db, makePhase(userId, workspaceId))

      const updated = updatePhase(db, {
        phaseId: phase.id,
        userId,
        title: 'Phase 1 — Groundwork',
        description: 'A reshaped write-up.',
        orderIndex: 3,
      })

      expect(updated.title).toBe('Phase 1 — Groundwork')
      expect(updated.description).toBe('A reshaped write-up.')
      expect(updated.orderIndex).toBe(3)
      expect(listOutboxEventsByType(db, PHASE_UPDATED)).toHaveLength(1)
    })
  })

  it('completing stamps completedAt and emits phase.completed; reopening clears it', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const phase = insertPhase(db, makePhase(userId, workspaceId))

      const done = updatePhase(db, { phaseId: phase.id, userId, status: 'done' })
      expect(done.completedAt).not.toBeNull()
      expect(listOutboxEventsByType(db, PHASE_COMPLETED)).toHaveLength(1)

      const reopened = updatePhase(db, { phaseId: phase.id, userId, status: 'open' })
      expect(reopened.completedAt).toBeNull()
      expect(listOutboxEventsByType(db, PHASE_UPDATED)).toHaveLength(1)
    })
  })

  it('rejects a negative or fractional orderIndex', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const phase = insertPhase(db, makePhase(userId, workspaceId))
      expect(() => updatePhase(db, { phaseId: phase.id, userId, orderIndex: -1 })).toThrow(
        ValidationError,
      )
      expect(() => updatePhase(db, { phaseId: phase.id, userId, orderIndex: 1.5 })).toThrow(
        ValidationError,
      )
    })
  })

  it('404s for a missing phase and for another user (same error)', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const stranger = seedUserWorkspace(db)
      const phase = insertPhase(db, makePhase(userId, workspaceId))

      expect(() => updatePhase(db, { phaseId: 'missing', userId, status: 'done' })).toThrow(
        NotFoundError,
      )
      expect(() =>
        updatePhase(db, { phaseId: phase.id, userId: stranger.userId, status: 'done' }),
      ).toThrow(NotFoundError)
    })
  })
})
