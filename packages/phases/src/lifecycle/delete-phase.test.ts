import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { NotFoundError } from '@vynel/errors'
import { seedUserWorkspace, insertPhase, makePhase } from '../test-support.js'
import { deletePhase } from './delete-phase.js'
import { getPhaseOrThrow } from '../queries/list-phases.js'
import { PHASE_DELETED } from '../phases-events.js'

describe('deletePhase', () => {
  it('hard-deletes and co-commits phase.deleted', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const phase = insertPhase(db, makePhase(userId, workspaceId))

      deletePhase(db, { phaseId: phase.id, userId })

      expect(() => getPhaseOrThrow(db, { phaseId: phase.id, userId })).toThrow(NotFoundError)
      const events = listOutboxEventsByType(db, PHASE_DELETED)
      expect(events).toHaveLength(1)
      expect(events[0]!.payload).toMatchObject({ phaseId: phase.id, userId, workspaceId })
    })
  })

  it("404s for a missing phase and for another user's phase (same error)", async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const stranger = seedUserWorkspace(db)
      const phase = insertPhase(db, makePhase(userId, workspaceId))

      expect(() => deletePhase(db, { phaseId: 'missing', userId })).toThrow(NotFoundError)
      expect(() => deletePhase(db, { phaseId: phase.id, userId: stranger.userId })).toThrow(
        NotFoundError,
      )
      // Still there — the stranger's attempt must not delete.
      expect(getPhaseOrThrow(db, { phaseId: phase.id, userId }).id).toBe(phase.id)
    })
  })
})
