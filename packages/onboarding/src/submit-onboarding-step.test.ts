// Dispatcher tests — validation, step progression, and the completion seam,
// exercised against FAKE OnboardingDeps (the schedules / channels fake-deps
// precedent): the two user ops write through the kernel repo so the profile /
// gate-flip assertions observe real DB state (the real @vynel/core ops are the
// same thin repo wrappers). Spec: blueprint.md §14.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import type { Database } from '@vynel/db'
import { insertUser, findUserById, updateUser } from '@vynel/db/repositories/users'
import { findOnboardingRunById } from '@vynel/db/repositories/onboarding'
import { startOnboardingRun } from './start-onboarding-run.js'
import { submitOnboardingStep } from './submit-onboarding-step.js'
import type { OnboardingDeps } from './onboarding-types.js'

function makeFakeDeps(): OnboardingDeps {
  return {
    updateUserProfile: (opDb, userId, patch) => updateUser(opDb, userId, patch),
    markUserOnboardingComplete: (opDb, userId) =>
      updateUser(opDb, userId, { hasCompletedOnboarding: true }),
  }
}

function seedUser(db: Database): string {
  const now = new Date()
  return insertUser(db, {
    id: randomUUID(),
    displayName: 'Test User',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  }).id
}

describe('submitOnboardingStep', () => {
  it('runs the whole flow: welcome advances, profile writes the user row and completes the run', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const run = startOnboardingRun(db, userId)
      const deps = makeFakeDeps()

      const afterWelcome = await submitOnboardingStep(
        db,
        { userId, runId: run.id, stepKind: 'welcome', stepInput: { acknowledged: true } },
        deps,
      )
      expect(afterWelcome.currentStepKind).toBe('profile')
      expect(afterWelcome.status).toBe('in-progress')

      const afterProfile = await submitOnboardingStep(
        db,
        {
          userId,
          runId: run.id,
          stepKind: 'profile',
          stepInput: { displayName: 'Sam Lee', locale: 'en-GB', timezone: 'Europe/London' },
        },
        deps,
      )
      expect(afterProfile.status).toBe('completed')

      const user = findUserById(db, userId)
      expect(user?.displayName).toBe('Sam Lee')
      expect(user?.timezone).toBe('Europe/London')
      expect(user?.hasCompletedOnboarding).toBe(true)
    })
  })

  it('refuses a step that is not the current one', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const run = startOnboardingRun(db, userId)
      await expect(
        submitOnboardingStep(
          db,
          {
            userId,
            runId: run.id,
            stepKind: 'profile',
            stepInput: { displayName: 'Sam', locale: 'en-US', timezone: 'UTC' },
          },
          makeFakeDeps(),
        ),
      ).rejects.toThrow(/welcome/)
    })
  })

  it('refuses a completed run', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const run = startOnboardingRun(db, userId)
      const deps = makeFakeDeps()
      await submitOnboardingStep(
        db,
        { userId, runId: run.id, stepKind: 'welcome', stepInput: { acknowledged: true } },
        deps,
      )
      await submitOnboardingStep(
        db,
        {
          userId,
          runId: run.id,
          stepKind: 'profile',
          stepInput: { displayName: 'Sam', locale: 'en-US', timezone: 'UTC' },
        },
        deps,
      )
      await expect(
        submitOnboardingStep(
          db,
          { userId, runId: run.id, stepKind: 'welcome', stepInput: { acknowledged: true } },
          deps,
        ),
      ).rejects.toThrow(/already complete/)
    })
  })

  it('404s an unknown run and a foreign user', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const run = startOnboardingRun(db, userId)
      await expect(
        submitOnboardingStep(
          db,
          { userId, runId: randomUUID(), stepKind: 'welcome', stepInput: { acknowledged: true } },
          makeFakeDeps(),
        ),
      ).rejects.toThrow()
      await expect(
        submitOnboardingStep(
          db,
          {
            userId: randomUUID(),
            runId: run.id,
            stepKind: 'welcome',
            stepInput: { acknowledged: true },
          },
          makeFakeDeps(),
        ),
      ).rejects.toThrow()
    })
  })

  it('rejects a malformed step input without advancing the run', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const run = startOnboardingRun(db, userId)
      await expect(
        submitOnboardingStep(
          db,
          { userId, runId: run.id, stepKind: 'welcome', stepInput: { acknowledged: false } },
          makeFakeDeps(),
        ),
      ).rejects.toThrow()
      expect(findOnboardingRunById(db, run.id)?.currentStepKind).toBe('welcome')
    })
  })
})
