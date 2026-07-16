import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { seedUserWorkspace, makeQuestions } from '../test-support.js'
import { listPendingAskRequestsForUser } from '../repositories/index.js'
import { PendingAskRegistry } from '../waiting/pending-ask-registry.js'
import { runAskUserBridge } from './ask-user-tool.js'

describe('runAskUserBridge', () => {
  it('records a pending ask, PARKS, and returns what the registry resolves', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const waiters = new PendingAskRegistry()

      const bridge = runAskUserBridge(
        db,
        { userId, workspaceId },
        { waiters, turnKey: 'turn-1' },
        makeQuestions(),
      )

      // Parked: the row is pending and the waiter is registered.
      const [pending] = listPendingAskRequestsForUser(db, userId)
      expect(pending).toBeDefined()
      expect(waiters.has(pending!.id)).toBe(true)

      // The outside world (the answer route) resolves; the bridge returns it.
      waiters.resolve(pending!.id, { answered: true, answers: { audience: 'Regulars' } })
      await expect(bridge).resolves.toEqual({ answered: true, answers: { audience: 'Regulars' } })
    })
  })

  it("the owning turn's cancel unblocks the bridge with cancelled", async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const waiters = new PendingAskRegistry()

      const bridge = runAskUserBridge(
        db,
        { userId, workspaceId },
        { waiters, turnKey: 'turn-1' },
        makeQuestions(),
      )
      const cancelled = waiters.cancelForTurn('turn-1')
      expect(cancelled).toHaveLength(1)
      await expect(bridge).resolves.toEqual({ answered: false, reason: 'cancelled' })
    })
  })
})
