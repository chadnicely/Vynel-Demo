// Dispatcher tests — validation, step progression, and the completion seam,
// exercised against FAKE OnboardingDeps (the schedules / channels fake-deps
// precedent): recorders for the sibling ops, with the two user ops writing
// through the kernel repo so the profile / gate-flip assertions observe real
// DB state (the real @vynel/core ops are the same thin repo wrappers).
// The seam inversion makes the formerly FS/network-heavy steps
// (name-workspace, identity-seed, install-skills, optional-channel) testable
// here; the real-op happy paths remain with the deferred real-workspace smoke
// test (blueprint §12). Spec: blueprint.md §14.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { withTestDatabase } from '@vynel/testing'
import type { Database } from '@vynel/db'
import { insertUser, findUserById, updateUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { insertOnboardingRun } from '@vynel/db/repositories/onboarding'
import { startOnboardingRun } from './start-onboarding-run.js'
import { submitOnboardingStep } from './submit-onboarding-step.js'
import type { MemorySeedEntry, NewOnboardingRun, OnboardingDeps } from './onboarding-types.js'

// The name-workspace handler's mkdirSync writes for real — park it in the OS
// temp dir.
const tmpParent = path.join(os.tmpdir(), 'vynel-onboarding-tests', randomUUID())

interface RecordedOps {
  workspaces: Array<{ name: string; directory: string }>
  memoryEntries: MemorySeedEntry[]
  installedSkillIds: string[]
  channels: Array<{ channelKind: string; displayName: string }>
  schedules: Array<{
    templateKind: string
    cronExpression: string
    timezone: string
    destinationKind: string
    channelId: string | undefined
  }>
}

function makeFakeDeps(overrides: Partial<OnboardingDeps> = {}): {
  deps: OnboardingDeps
  recorded: RecordedOps
} {
  const recorded: RecordedOps = {
    workspaces: [],
    memoryEntries: [],
    installedSkillIds: [],
    channels: [],
    schedules: [],
  }
  const deps: OnboardingDeps = {
    resolveDefaultWorkspaceLocation: () => tmpParent,
    sanitizeFolderName: (rawName) => rawName,
    createWorkspace: async (opDb, input) => {
      recorded.workspaces.push({ name: input.name, directory: input.directory })
      // A real kernel row, not a fabricated id — the run update writes
      // `primaryWorkspaceId` behind an FK to workspaces.id.
      const now = new Date()
      const row = insertWorkspace(opDb, {
        id: randomUUID(),
        userId: input.userId,
        name: input.name,
        kind: 'small-business',
        path: input.directory,
        isArchived: false,
        createdAt: now,
        updatedAt: now,
        lastAccessedAt: now,
      })
      return { id: row.id, path: row.path }
    },
    updateUserProfile: (opDb, userId, patch) => updateUser(opDb, userId, patch),
    markUserOnboardingComplete: (opDb, userId) =>
      updateUser(opDb, userId, { hasCompletedOnboarding: true }),
    createMemoryEntry: (_db, entry) => {
      recorded.memoryEntries.push(entry)
    },
    installSkill: async (_db, input) => {
      recorded.installedSkillIds.push(input.skillId)
    },
    connectChannel: async (_db, input) => {
      recorded.channels.push({ channelKind: input.channelKind, displayName: input.displayName })
      return { id: 'channel-1' }
    },
    createSchedule: (_db, input) => {
      recorded.schedules.push({
        templateKind: input.templateKind,
        cronExpression: input.cronExpression,
        timezone: input.timezone,
        destinationKind: input.destinationKind,
        channelId: input.channelId,
      })
    },
    ...overrides,
  }
  return { deps, recorded }
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

function seedWorkspace(db: Database, userId: string): string {
  const now = new Date()
  return insertWorkspace(db, {
    id: randomUUID(),
    userId,
    name: 'Acme',
    kind: 'small-business',
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }).id
}

function seedRunAt(
  db: Database,
  userId: string,
  currentStepKind: NewOnboardingRun['currentStepKind'],
  workspaceId: string | null,
  collectedData: Record<string, unknown> = {},
) {
  const now = new Date()
  return insertOnboardingRun(db, {
    id: randomUUID(),
    userId,
    workspaceId,
    currentStepKind,
    completedSteps: [],
    collectedData,
    status: 'in-progress',
    startedAt: now,
    lastActivityAt: now,
    completedAt: null,
  })
}

describe('submitOnboardingStep — dispatcher', () => {
  it('advances DB-only steps welcome → profile → name-workspace and updates the user', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const run = startOnboardingRun(db, userId)
      const { deps } = makeFakeDeps()

      const afterWelcome = await submitOnboardingStep(
        db,
        { userId, runId: run.id, stepKind: 'welcome', stepInput: { acknowledged: true } },
        deps,
      )
      expect(afterWelcome.currentStepKind).toBe('profile')

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
      // Kind picker retired ("stop asking") — profile now advances straight to
      // name-workspace.
      expect(afterProfile.currentStepKind).toBe('name-workspace')
      expect(afterProfile.completedSteps).toEqual(['welcome', 'profile'])
      expect(findUserById(db, userId)?.displayName).toBe('Sam Lee')
      expect(findUserById(db, userId)?.timezone).toBe('Europe/London')
    })
  })

  it('rejects a wrong stepKind and a foreign user', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const run = startOnboardingRun(db, userId) // parked at welcome
      const { deps } = makeFakeDeps()

      await expect(
        submitOnboardingStep(db, { userId, runId: run.id, stepKind: 'profile', stepInput: {} }, deps),
      ).rejects.toThrow()

      await expect(
        submitOnboardingStep(
          db,
          { userId: randomUUID(), runId: run.id, stepKind: 'welcome', stepInput: { acknowledged: true } },
          deps,
        ),
      ).rejects.toThrow()
    })
  })

  it('name-workspace creates the folder and registers it via the injected createWorkspace', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const run = seedRunAt(db, userId, 'name-workspace', null)
      const { deps, recorded } = makeFakeDeps()

      const after = await submitOnboardingStep(
        db,
        { userId, runId: run.id, stepKind: 'name-workspace', stepInput: { name: 'My Bakery' } },
        deps,
      )

      const expectedDirectory = path.join(tmpParent, 'My Bakery')
      expect(recorded.workspaces).toEqual([{ name: 'My Bakery', directory: expectedDirectory }])
      expect(after.workspaceId).toBeTruthy()
      expect(after.collectedData['workspacePath']).toBe(expectedDirectory)
      expect(after.currentStepKind).toBe('identity-seed')
    })
  })

  it('identity-seed writes the answers through the injected createMemoryEntry', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const workspaceId = seedWorkspace(db, userId)
      const run = seedRunAt(db, userId, 'identity-seed', workspaceId)
      const { deps, recorded } = makeFakeDeps()

      const after = await submitOnboardingStep(
        db,
        {
          userId,
          runId: run.id,
          stepKind: 'identity-seed',
          stepInput: {
            aboutYouParagraph: 'I run a small bakery.',
            workspaceContextAnswer: 'Track supplier emails and invoices.',
            workingStyleAnswer: 'Short and direct.',
          },
        },
        deps,
      )

      expect(recorded.memoryEntries.map((entry) => entry.category)).toEqual([
        'user',
        'memory',
        'preferences',
      ])
      expect(recorded.memoryEntries.every((entry) => entry.workspaceId === workspaceId)).toBe(true)
      expect(after.currentStepKind).toBe('install-suggested-skills')
    })
  })

  it('install-suggested-skills installs known skills and skips unknown ids', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const workspaceId = seedWorkspace(db, userId)
      const run = seedRunAt(db, userId, 'install-suggested-skills', workspaceId, {
        workspacePath: '/tmp/vynel/acme',
      })
      const { deps, recorded } = makeFakeDeps()

      const after = await submitOnboardingStep(
        db,
        {
          userId,
          runId: run.id,
          stepKind: 'install-suggested-skills',
          stepInput: { skillIdsToInstall: ['email-drafter', 'not-in-catalog'] },
        },
        deps,
      )

      expect(recorded.installedSkillIds).toEqual(['email-drafter'])
      expect(after.currentStepKind).toBe('optional-channel')
    })
  })

  it('a failing skill install is non-fatal — the step still advances (D8)', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const workspaceId = seedWorkspace(db, userId)
      const run = seedRunAt(db, userId, 'install-suggested-skills', workspaceId, {
        workspacePath: '/tmp/vynel/acme',
      })
      const { deps } = makeFakeDeps({
        installSkill: async () => {
          throw new Error('disk full')
        },
      })

      const after = await submitOnboardingStep(
        db,
        {
          userId,
          runId: run.id,
          stepKind: 'install-suggested-skills',
          stepInput: { skillIdsToInstall: ['email-drafter'] },
        },
        deps,
      )
      expect(after.currentStepKind).toBe('optional-channel')
    })
  })

  it('optional-channel connect stashes the channelId from the injected connectChannel', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const workspaceId = seedWorkspace(db, userId)
      const run = seedRunAt(db, userId, 'optional-channel', workspaceId)
      const { deps, recorded } = makeFakeDeps()

      const after = await submitOnboardingStep(
        db,
        {
          userId,
          runId: run.id,
          stepKind: 'optional-channel',
          stepInput: {
            kind: 'connect',
            channelKind: 'telegram',
            displayName: 'Bakery Bot',
            botCredentials: { botToken: 'test-token' },
          },
        },
        deps,
      )

      expect(recorded.channels).toEqual([{ channelKind: 'telegram', displayName: 'Bakery Bot' }])
      expect(after.collectedData['channelId']).toBe('channel-1')
      expect(after.currentStepKind).toBe('optional-schedule')
    })
  })

  it('completing the last step (skipped schedule) flips users.hasCompletedOnboarding', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const workspaceId = seedWorkspace(db, userId)
      const run = seedRunAt(db, userId, 'optional-schedule', workspaceId)
      const { deps } = makeFakeDeps()

      const done = await submitOnboardingStep(
        db,
        { userId, runId: run.id, stepKind: 'optional-schedule', stepInput: { kind: 'skipped' } },
        deps,
      )
      expect(done.status).toBe('completed')
      expect(findUserById(db, userId)?.hasCompletedOnboarding).toBe(true)

      // Re-submitting a completed run is rejected.
      await expect(
        submitOnboardingStep(
          db,
          { userId, runId: run.id, stepKind: 'optional-schedule', stepInput: { kind: 'skipped' } },
          deps,
        ),
      ).rejects.toThrow()
    })
  })

  it('the create-morning-briefing path calls the injected createSchedule and completes the run', async () => {
    await withTestDatabase(async (db) => {
      const userId = seedUser(db)
      const workspaceId = seedWorkspace(db, userId)
      const run = seedRunAt(db, userId, 'optional-schedule', workspaceId, {
        profile: { displayName: 'X', locale: 'en-US', timezone: 'America/New_York' },
      })
      const { deps, recorded } = makeFakeDeps()

      const done = await submitOnboardingStep(
        db,
        {
          userId,
          runId: run.id,
          stepKind: 'optional-schedule',
          stepInput: { kind: 'create-morning-briefing', fireHour: 7 },
        },
        deps,
      )

      expect(recorded.schedules).toEqual([
        {
          templateKind: 'morning-briefing',
          cronExpression: '0 7 * * *',
          timezone: 'America/New_York',
          destinationKind: 'chat-only',
          channelId: undefined,
        },
      ])
      expect(done.status).toBe('completed')
      expect(findUserById(db, userId)?.hasCompletedOnboarding).toBe(true)
    })
  })
})
