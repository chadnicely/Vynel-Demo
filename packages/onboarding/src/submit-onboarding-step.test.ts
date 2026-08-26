// Dispatcher tests — validation, step progression, and the completion seam,
// exercised against FAKE OnboardingDeps (the schedules / channels fake-deps
// precedent): the user ops write through the kernel repo so the profile /
// gate-flip assertions observe real DB state (the real @vynel/core ops are the
// same thin repo wrappers); the memory op records what the seed step hands it.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import type { Database } from '@vynel/db'
import { insertUser, findUserById, updateUser } from '@vynel/db/repositories/users'
import { findOnboardingRunById } from '@vynel/db/repositories/onboarding'
import { startOnboardingRun } from './start-onboarding-run.js'
import { submitOnboardingStep } from './submit-onboarding-step.js'
import type { MemorySeedEntry, OnboardingDeps } from './onboarding-types.js'

function makeFakeDeps(): OnboardingDeps & { seededEntries: MemorySeedEntry[] } {
  const seededEntries: MemorySeedEntry[] = []
  return {
    seededEntries,
    updateUserProfile: (opDb, userId, patch) => updateUser(opDb, userId, patch),
    markUserOnboardingComplete: (opDb, userId) =>
      updateUser(opDb, userId, { hasCompletedOnboarding: true }),
    createMemoryEntry: (_opDb, entry) => {
      seededEntries.push(entry)
    },
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

const PROFILE = { displayName: 'Sam Lee', locale: 'en-GB', timezone: 'Europe/London' }
const ANSWERS = {
  aboutYouParagraph: 'I run a small bakery.',
  workspaceContextAnswer: 'Supplier emails and invoices.',
  workingStyleAnswer: 'Short answers.',
}

async function walkToStep(
  db: Database,
  userId: string,
  runId: string,
  deps: OnboardingDeps,
  stopBefore: 'identity-seed' | 'connect-brain' | 'github-backup',
) {
  await submitOnboardingStep(
    db,
    { userId, runId, stepKind: 'welcome', stepInput: { acknowledged: true } },
    deps,
  )
  await submitOnboardingStep(db, { userId, runId, stepKind: 'profile', stepInput: PROFILE }, deps)
  if (stopBefore === 'identity-seed') return
  await submitOnboardingStep(
    db,
    { userId, runId, stepKind: 'identity-seed', stepInput: ANSWERS },
    deps,
  )
  if (stopBefore === 'connect-brain') return
  await submitOnboardingStep(
    db,
    { userId, runId, stepKind: 'connect-brain', stepInput: { providerId: 'claude' } },
    deps,
  )
}

describe('submitOnboardingStep', () => {
  it('runs the whole flow: profile writes the user, the answers seed memory, the GitHub copy completes the run', async () => {
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

      const afterProfile = await submitOnboardingStep(
        db,
        { userId, runId: run.id, stepKind: 'profile', stepInput: PROFILE },
        deps,
      )
      expect(afterProfile.currentStepKind).toBe('identity-seed')
      expect(afterProfile.status).toBe('in-progress')
      expect(findUserById(db, userId)?.displayName).toBe('Sam Lee')
      expect(findUserById(db, userId)?.hasCompletedOnboarding).toBe(false)

      const afterSeed = await submitOnboardingStep(
        db,
        { userId, runId: run.id, stepKind: 'identity-seed', stepInput: ANSWERS },
        deps,
      )
      expect(afterSeed.currentStepKind).toBe('connect-brain')
      // Three answers → three USER-level entries (no workspace exists yet).
      expect(deps.seededEntries).toHaveLength(3)
      expect(deps.seededEntries.every((entry) => entry.workspaceId === null)).toBe(true)
      expect(deps.seededEntries.map((entry) => entry.body)).toEqual([
        ANSWERS.aboutYouParagraph,
        ANSWERS.workspaceContextAnswer,
        ANSWERS.workingStyleAnswer,
      ])

      const afterBrain = await submitOnboardingStep(
        db,
        { userId, runId: run.id, stepKind: 'connect-brain', stepInput: { providerId: 'claude' } },
        deps,
      )
      expect(afterBrain.currentStepKind).toBe('github-backup')

      const afterGitHub = await submitOnboardingStep(
        db,
        { userId, runId: run.id, stepKind: 'github-backup', stepInput: { kind: 'skipped' } },
        deps,
      )
      expect(afterGitHub.status).toBe('completed')
      expect(afterGitHub.collectedData).toMatchObject({
        profile: PROFILE,
        identitySeed: ANSWERS,
        connectBrain: { providerId: 'claude' },
        githubBackup: { kind: 'skipped' },
      })
      expect(findUserById(db, userId)?.hasCompletedOnboarding).toBe(true)
    })
  })

  it('completes the run on a connected GitHub copy too', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const run = startOnboardingRun(db, userId)
      const deps = makeFakeDeps()
      await walkToStep(db, userId, run.id, deps, 'github-backup')

      const done = await submitOnboardingStep(
        db,
        { userId, runId: run.id, stepKind: 'github-backup', stepInput: { kind: 'connected' } },
        deps,
      )
      expect(done.status).toBe('completed')
      expect(findUserById(db, userId)?.hasCompletedOnboarding).toBe(true)
    })
  })

  it('refuses a brain that is not Claude — the contract, not the handler, says no', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const run = startOnboardingRun(db, userId)
      const deps = makeFakeDeps()
      await walkToStep(db, userId, run.id, deps, 'connect-brain')

      await expect(
        submitOnboardingStep(
          db,
          { userId, runId: run.id, stepKind: 'connect-brain', stepInput: { providerId: 'codex' } },
          deps,
        ),
      ).rejects.toThrow()
      expect(findOnboardingRunById(db, run.id)?.currentStepKind).toBe('connect-brain')
    })
  })

  it('seeds two entries when the working-style answer is left out', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const run = startOnboardingRun(db, userId)
      const deps = makeFakeDeps()
      await walkToStep(db, userId, run.id, deps, 'identity-seed')

      await submitOnboardingStep(
        db,
        {
          userId,
          runId: run.id,
          stepKind: 'identity-seed',
          stepInput: { aboutYouParagraph: 'a', workspaceContextAnswer: 'b' },
        },
        deps,
      )
      expect(deps.seededEntries).toHaveLength(2)
    })
  })

  it('refuses a step that is not the current one', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const run = startOnboardingRun(db, userId)
      await expect(
        submitOnboardingStep(
          db,
          { userId, runId: run.id, stepKind: 'profile', stepInput: PROFILE },
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
      await walkToStep(db, userId, run.id, deps, 'github-backup')
      await submitOnboardingStep(
        db,
        { userId, runId: run.id, stepKind: 'github-backup', stepInput: { kind: 'skipped' } },
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
