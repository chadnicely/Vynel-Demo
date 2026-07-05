// Lifecycle ops integration test — real SQLite via @vynel/testing (no mocking).
// Spec: blueprint.md §14.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import type { Database } from '@vynel/db'
import { insertUser, findUserById, updateUser } from '@vynel/db/repositories/users'
import { startOnboardingRun } from './start-onboarding-run.js'
import { restartOnboardingRun } from './restart-onboarding-run.js'
import { advanceRun } from './advance-run.js'
import { getOnboardingRunStatus } from './get-onboarding-run-status.js'
import { checkIfOnboardingNeeded } from './check-if-onboarding-needed.js'
import { completeOnboardingRun } from './complete-onboarding-run.js'

function seedUser(db: Database): string {
  const now = new Date()
  return insertUser(db, {
    id: randomUUID(),
    displayName: 'Sam',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  }).id
}

describe('onboarding lifecycle', () => {
  it('start is find-or-create (one in-progress run per user)', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const a = startOnboardingRun(db, userId)
      const b = startOnboardingRun(db, userId)
      expect(b.id).toBe(a.id)
      expect(a.currentStepKind).toBe('welcome')
    })
  })

  it('advanceRun appends the step, merges collectedData, and advances', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const run = startOnboardingRun(db, userId)
      const advanced = advanceRun(db, run, 'welcome', { acknowledged: true })
      expect(advanced.currentStepKind).toBe('profile')
      expect(advanced.completedSteps).toContain('welcome')
      expect(advanced.status).toBe('in-progress')
    })
  })

  it('checkIfOnboardingNeeded reflects the user flag + in-progress run', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const before = checkIfOnboardingNeeded(db, userId)
      expect(before.needsOnboarding).toBe(true)
      expect(before.inProgressRunId).toBeNull()

      const run = startOnboardingRun(db, userId)
      expect(checkIfOnboardingNeeded(db, userId).inProgressRunId).toBe(run.id)
    })
  })

  it('completing the last step flips users.hasCompletedOnboarding + opens the gate', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const run = startOnboardingRun(db, userId)
      const atLast = advanceRun(db, run, 'optional-schedule', { kind: 'skipped' })
      expect(atLast.status).toBe('completed')

      // The gate flip is injected (invariant #2) — the fake writes through the
      // kernel repo exactly like @vynel/core's markUserOnboardingComplete does.
      completeOnboardingRun(db, userId, atLast.id, {
        markUserOnboardingComplete: (opDb, targetUserId) =>
          updateUser(opDb, targetUserId, { hasCompletedOnboarding: true }),
      })
      expect(findUserById(db, userId)?.hasCompletedOnboarding).toBe(true)
      expect(checkIfOnboardingNeeded(db, userId).needsOnboarding).toBe(false)
    })
  })

  it('restart abandons in-progress runs and starts fresh', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const first = startOnboardingRun(db, userId)
      const fresh = restartOnboardingRun(db, userId)
      expect(fresh.id).not.toBe(first.id)
      expect(fresh.status).toBe('in-progress')
    })
  })

  it('getOnboardingRunStatus returns a snapshot; throws 404 for a foreign user', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const run = startOnboardingRun(db, userId)
      const snap = getOnboardingRunStatus(db, userId, run.id)
      expect(snap.currentStep.stepKind).toBe('welcome')
      expect(snap.totalSteps).toBe(7)
      expect(() => getOnboardingRunStatus(db, randomUUID(), run.id)).toThrow()
    })
  })
})
