// A GLOBAL delivery claimed while the user's root-turn lock is busy yields its
// pool slot (session-hardening follow-up to A): before this it parked inside the
// core for as long as the interactive turn lasted — up to the cap — holding one
// of the few concurrent-delegation slots for nothing.
import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import type { Logger } from 'pino'
import { insertUser } from '@vynel/db/repositories/users'
import { enqueueReportDelivery, findDelegationJobById } from '@vynel/orchestration'
import { FakeAiAgentProvider } from '../runtime/test-support/fake-ai-agent-provider.js'
import { SessionActivityFeed } from '../runtime/session-activity-feed.js'
import { rootTurnLockKey, runUnderRootTurnLock } from '../runtime/root-turn-lock.js'
import { runDelegationClaimAndRunTick } from './run-delegation-claim-and-run-tick.js'

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} } as unknown as Logger

function makeUser(id: string = randomUUID()) {
  const now = new Date()
  return {
    id,
    displayName: 'Test User',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  }
}

describe('runReportDeliveryJob — a global delivery yields its slot while the root lock is busy', () => {
  it('requeues due-soon without spending an attempt, then runs once the interactive turn has settled', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const deliveryId = enqueueReportDelivery(db, {
        userId: user.id,
        reporterSessionId: 'child-sdk-1',
        reporterLabel: 'Research session',
        reportBody: 'The findings: three items.',
        requester: { kind: 'global-root' },
      })
      let notifyRuns = 0
      const deps = {
        provider: new FakeAiAgentProvider(),
        logger: silentLogger,
        activityFeed: new SessionActivityFeed(),
        runGlobalRootReportTurn: async () => {
          notifyRuns += 1
          return { sessionId: 'global-notify-sdk', resultText: 'Absorbed.' }
        },
      }

      // An interactive global turn holds the user's root lock.
      let releaseTurn!: () => void
      const heldTurn = runUnderRootTurnLock(
        rootTurnLockKey(user.id, false),
        () => new Promise<void>((resolve) => (releaseTurn = resolve)),
      )

      const before = Date.now()
      await runDelegationClaimAndRunTick(db, deps)
      expect(notifyRuns).toBe(0)
      const yielded = findDelegationJobById(db, deliveryId)!
      expect(yielded.status).toBe('pending')
      expect(yielded.attemptCount ?? 0).toBe(0)
      expect(yielded.nextAttemptAt!.getTime()).toBeGreaterThan(before)

      // Still busy → still not claimable (the due time has not come); once the
      // turn settles and the row is due, the next tick runs the notify turn.
      releaseTurn()
      await heldTurn
      // Make it due now — the yield's few-second backoff is not what is under test.
      const { requeueDelegationJob } = await import('@vynel/orchestration')
      requeueDelegationJob(db, deliveryId, {
        errorMessage: yielded.errorMessage ?? '',
        errorCode: yielded.errorCode ?? null,
        attemptCount: yielded.attemptCount ?? 0,
        nextAttemptAt: new Date(0),
      })
      await runDelegationClaimAndRunTick(db, deps)
      expect(notifyRuns).toBe(1)
      expect(findDelegationJobById(db, deliveryId)!.status).toBe('completed')
    })
  })
})
