import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { seedUserWorkspace, makeAskRequest, insertAskRequest, findAskRequestById } from '../test-support.js'
import { expireAskRequests } from './expire-ask-requests.js'
import { ASK_RESOLVED } from '../asks-events.js'

describe('expireAskRequests', () => {
  it('boot mode expires EVERY pending ask and co-commits an event per row', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const pendingA = insertAskRequest(db, makeAskRequest(userId, workspaceId))
      const pendingB = insertAskRequest(db, makeAskRequest(userId, null))
      const answered = insertAskRequest(
        db,
        makeAskRequest(userId, workspaceId, { status: 'answered', resolvedAt: new Date() }),
      )

      const result = expireAskRequests(db)
      expect(result.expiredCount).toBe(2)
      expect(findAskRequestById(db, pendingA.id)!.status).toBe('expired')
      expect(findAskRequestById(db, pendingB.id)!.status).toBe('expired')
      expect(findAskRequestById(db, answered.id)!.status).toBe('answered') // untouched

      expect(listOutboxEventsByType(db, ASK_RESOLVED)).toHaveLength(2)
    })
  })

  it('targeted mode expires only the given pending ids (resolved ids are skipped)', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const target = insertAskRequest(db, makeAskRequest(userId, workspaceId))
      const untouched = insertAskRequest(db, makeAskRequest(userId, workspaceId))
      const dismissed = insertAskRequest(
        db,
        makeAskRequest(userId, workspaceId, { status: 'dismissed', resolvedAt: new Date() }),
      )

      const result = expireAskRequests(db, { askIds: [target.id, dismissed.id, 'missing'] })
      expect(result.expiredCount).toBe(1)
      expect(findAskRequestById(db, target.id)!.status).toBe('expired')
      expect(findAskRequestById(db, untouched.id)!.status).toBe('pending')
      expect(findAskRequestById(db, dismissed.id)!.status).toBe('dismissed')
    })
  })

  it('age-reap mode expires only the pending rows created before the cutoff (the 60 s reaper read)', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const cutoff = new Date(Date.now() - 2 * 60 * 60_000)
      const stale = insertAskRequest(
        db,
        makeAskRequest(userId, workspaceId, { createdAt: new Date(cutoff.getTime() - 60_000) }),
      )
      const fresh = insertAskRequest(db, makeAskRequest(userId, workspaceId))
      const staleButAnswered = insertAskRequest(
        db,
        makeAskRequest(userId, null, {
          status: 'answered',
          resolvedAt: new Date(),
          createdAt: new Date(cutoff.getTime() - 60_000),
        }),
      )

      const result = expireAskRequests(db, { pendingBefore: cutoff })
      expect(result.expiredCount).toBe(1)
      expect(findAskRequestById(db, stale.id)!.status).toBe('expired')
      // A young pending row is a live form — its own waiter owns its bound.
      expect(findAskRequestById(db, fresh.id)!.status).toBe('pending')
      expect(findAskRequestById(db, staleButAnswered.id)!.status).toBe('answered')
      expect(listOutboxEventsByType(db, ASK_RESOLVED)).toHaveLength(1)
    })
  })
})
