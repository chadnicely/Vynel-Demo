// Repository tests for `onboarding_runs`. Real SQLite via the LOCAL
// test-support helper (avoids the db ↔ testing workspace cycle). No DB mocking.
//
// Spec: `docs/blueprints/onboarding/blueprint.md §14`.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '../../test-support/with-test-database.js'
import { insertUser } from '../users/users.js'
import {
  insertOnboardingRun,
  findOnboardingRunById,
  findInProgressRunForUser,
  listInProgressRunsForUser,
  updateOnboardingRun,
  type NewOnboardingRun,
} from './onboarding-runs.js'

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

function makeRun(userId: string, overrides: Partial<NewOnboardingRun> = {}): NewOnboardingRun {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    workspaceId: null,
    currentStepKind: 'welcome',
    completedSteps: [],
    collectedData: {},
    status: 'in-progress',
    startedAt: now,
    lastActivityAt: now,
    completedAt: null,
    ...overrides,
  }
}

describe('onboarding_runs repository', () => {
  it('inserts a run and finds it by id (JSON columns round-trip)', async () => {
    await withTestDatabase(async (db) => {
      const userId = randomUUID()
      insertUser(db, makeUser(userId))
      const run = insertOnboardingRun(
        db,
        makeRun(userId, { completedSteps: ['welcome'], collectedData: { workspacePath: '/tmp/ws' } }),
      )

      const found = findOnboardingRunById(db, run.id)
      expect(found?.id).toBe(run.id)
      expect(found?.currentStepKind).toBe('welcome')
      expect(found?.completedSteps).toEqual(['welcome'])
      expect(found?.collectedData).toEqual({ workspacePath: '/tmp/ws' })
    })
  })

  it('findOnboardingRunById returns null when absent', async () => {
    await withTestDatabase(async (db) => {
      expect(findOnboardingRunById(db, randomUUID())).toBeNull()
    })
  })

  it('findInProgressRunForUser is userId-scoped and excludes completed/abandoned runs', async () => {
    await withTestDatabase(async (db) => {
      const userA = randomUUID()
      const userB = randomUUID()
      insertUser(db, makeUser(userA))
      insertUser(db, makeUser(userB))
      const aRun = insertOnboardingRun(db, makeRun(userA))
      insertOnboardingRun(db, makeRun(userA, { status: 'completed' }))
      insertOnboardingRun(db, makeRun(userB)) // other user's in-progress run

      expect(findInProgressRunForUser(db, userA)?.id).toBe(aRun.id)
    })
  })

  it('listInProgressRunsForUser returns every in-progress run for the user', async () => {
    await withTestDatabase(async (db) => {
      const userId = randomUUID()
      insertUser(db, makeUser(userId))
      insertOnboardingRun(db, makeRun(userId))
      insertOnboardingRun(db, makeRun(userId))
      insertOnboardingRun(db, makeRun(userId, { status: 'abandoned' }))

      expect(listInProgressRunsForUser(db, userId)).toHaveLength(2)
    })
  })

  it('updateOnboardingRun applies a patch and throws on no-row', async () => {
    await withTestDatabase(async (db) => {
      const userId = randomUUID()
      insertUser(db, makeUser(userId))
      const run = insertOnboardingRun(db, makeRun(userId))

      const updated = updateOnboardingRun(db, run.id, {
        status: 'completed',
        currentStepKind: 'optional-schedule',
      })
      expect(updated.status).toBe('completed')
      expect(updated.currentStepKind).toBe('optional-schedule')

      expect(() => updateOnboardingRun(db, randomUUID(), { status: 'abandoned' })).toThrow()
    })
  })
})
