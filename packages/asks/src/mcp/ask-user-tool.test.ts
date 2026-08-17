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

  it('a bounded wait EXPIRES: resolves expired + the row leaves pending (unattended surfaces)', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const waiters = new PendingAskRegistry()

      const bridge = runAskUserBridge(
        db,
        { userId, workspaceId },
        { waiters, turnKey: 'turn-1', timeoutMs: 20 },
        makeQuestions(),
      )
      await expect(bridge).resolves.toEqual({ answered: false, reason: 'expired' })
      // The row expired with the waiter — nothing pending survives the wait.
      expect(listPendingAskRequestsForUser(db, userId)).toHaveLength(0)
    })
  })

  it('an answer beats the timer: the bounded wait resolves the ANSWER and the timer is inert', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const waiters = new PendingAskRegistry()

      const bridge = runAskUserBridge(
        db,
        { userId, workspaceId },
        { waiters, turnKey: 'turn-1', timeoutMs: 60_000 },
        makeQuestions(),
      )
      const [pending] = listPendingAskRequestsForUser(db, userId)
      waiters.resolve(pending!.id, { answered: true, answers: { audience: 'Regulars' } })
      await expect(bridge).resolves.toEqual({ answered: true, answers: { audience: 'Regulars' } })
    })
  })

  it('cancel with a live timer: resolves cancelled and the timer never expires the row', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const waiters = new PendingAskRegistry()

      const bridge = runAskUserBridge(
        db,
        { userId, workspaceId },
        { waiters, turnKey: 'turn-1', timeoutMs: 20 },
        makeQuestions(),
      )
      expect(waiters.cancelForTurn('turn-1')).toHaveLength(1)
      await expect(bridge).resolves.toEqual({ answered: false, reason: 'cancelled' })
      // Outwait the timer window: cancel cleared it, so the row is still
      // PENDING — expiring a cancelled turn's rows is the owning stream's
      // cleanup, never the timer's.
      await new Promise((resolve) => setTimeout(resolve, 40))
      expect(listPendingAskRequestsForUser(db, userId)).toHaveLength(1)
    })
  })

  it('stamps the asking chat session on the row when the turn knows it', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const waiters = new PendingAskRegistry()

      const bridge = runAskUserBridge(
        db,
        { userId, workspaceId, resolveSessionId: () => 'chat-session-1' },
        { waiters, turnKey: 'turn-1' },
        makeQuestions(),
      )
      const [pending] = listPendingAskRequestsForUser(db, userId)
      expect(pending!.sessionId).toBe('chat-session-1')
      waiters.cancelForTurn('turn-1')
      await bridge
    })
  })

  // THE regression. A fresh workspace conversation composes its toolset before
  // it has a session id, so a build-time value was always absent and the ask
  // recorded nothing — which left the conversation's status light saying
  // "working" while it was in fact parked on a form. Reading the getter at CALL
  // time is what fixes it; with an eager field this comes back null.
  it('a session resolved AFTER the toolset was composed still lands on the row', async () => {
    await withTestDatabase(async (db) => {
      const { userId, workspaceId } = seedUserWorkspace(db)
      const waiters = new PendingAskRegistry()
      // The carrier's state at composition time: nothing yet.
      let turnSessionId: string | undefined

      const scope = { userId, workspaceId, resolveSessionId: () => turnSessionId }

      // The stream's first frame resolves it, long before the model can call.
      turnSessionId = 'chat-session-late'

      const bridge = runAskUserBridge(db, scope, { waiters, turnKey: 'turn-1' }, makeQuestions())
      const [pending] = listPendingAskRequestsForUser(db, userId)
      expect(pending!.sessionId).toBe('chat-session-late')
      waiters.cancelForTurn('turn-1')
      await bridge
    })
  })

  it('records no session when the turn has no watching conversation', async () => {
    await withTestDatabase(async (db) => {
      const { userId } = seedUserWorkspace(db)
      const waiters = new PendingAskRegistry()

      const bridge = runAskUserBridge(
        db,
        { userId, workspaceId: null, resolveSessionId: () => undefined },
        { waiters, turnKey: 'turn-1' },
        makeQuestions(),
      )
      const [pending] = listPendingAskRequestsForUser(db, userId)
      expect(pending!.sessionId).toBeNull()
      waiters.cancelForTurn('turn-1')
      await bridge
    })
  })
})
