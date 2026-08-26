// Integration tests for `synchronizeSkillsWithProvider`. Real
// SQLite + real filesystem + a fake `AiAgentProvider` injected
// for testability (we don't want to depend on the live Claude
// runtime in unit tests).

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  listInstalledSkillsForUserAndWorkspace,
  findInstalledSkillById,
} from '../repositories/index.js'
import type { AiAgentProvider } from '@vynel/providers'
import { installSkill } from './install-skill.js'
import { synchronizeSkillsWithProvider } from './synchronize-skills-with-provider.js'
import { withHomeDir } from '../internal/resolve-host-home-dir.js'

function makeUser() {
  const now = new Date()
  return {
    id: randomUUID(),
    displayName: 'Test',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  }
}

function makeWorkspace(userId: string, workspacePath: string) {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    name: 'Test',
    kind: 'small-business' as const,
    path: workspacePath,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }
}

// Fake provider — only `discoverInstalledSkills` is exercised by
// the sync op; the rest throw to signal misuse.
function makeFakeProvider(
  skills: Awaited<ReturnType<AiAgentProvider['discoverInstalledSkills']>>,
): AiAgentProvider {
  return {
    providerId: 'claude' as const,
    discoverInstalledSkills: async () => skills,
    getAuthenticationStatus: async () => {
      throw new Error('not used in sync tests')
    },
    listConfiguredMcpServers: async () => [],
    startChatSession: () => {
      throw new Error('not used')
    },
    respondToApprovalRequest: async () => {
      throw new Error('not used')
    },
    interruptChatSession: async () => {
      throw new Error('not used')
    },
    fetchPersistedSessionTranscript: async () => {
      throw new Error('not used')
    },
    synchronizePersistedSessions: async () => [],
    getContextReport: async () => null,
    summarizeSession: async () => null,
    summarizeReport: async () => null,
    discoverModels: async () => null,
    studyRivalSite: async () => null,
    synthesizeWorkspacePlan: async () => null,
    setSessionPermissionMode: async () => false,
  } as AiAgentProvider
}

async function withFsAndDb<T>(
  fn: (workspacePath: string, dbRunner: typeof withTestDatabase) => Promise<T>,
): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'vynel-sync-test-'))
  try {
    return await withHomeDir(dir, () => fn(dir, withTestDatabase))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('synchronizeSkillsWithProvider', () => {
  it('marks healthy when DB row + on-disk file both exist', async () => {
    await withFsAndDb(async (workspacePath, withDb) => {
      await withDb(async (db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id, workspacePath))
        const installed = await installSkill(db, {
          userId: user.id,
          workspaceId: workspace.id,
          workspacePath,
          skillId: 'email-drafter',
          scope: 'user',
        })

        const stats = await synchronizeSkillsWithProvider(db, {
          userId: user.id,
          workspaceId: workspace.id,
          workspacePath,
          provider: makeFakeProvider([
            {
              providerId: 'claude',
              scope: 'user',
              skillName: 'email-drafter',
              displayDescription: null,
              installLocation: installed.installLocation,
              invocationSyntax: '/email-drafter',
            },
          ]),
        })

        expect(stats.healthyCount).toBe(1)
        expect(stats.missingOnDiskCount).toBe(0)
        expect(stats.externalDiscoveredCount).toBe(0)
      })
    })
  })

  it('marks missing-on-disk when the file is removed externally', async () => {
    await withFsAndDb(async (workspacePath, withDb) => {
      await withDb(async (db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id, workspacePath))
        const installed = await installSkill(db, {
          userId: user.id,
          workspaceId: workspace.id,
          workspacePath,
          skillId: 'email-drafter',
          scope: 'user',
        })
        // Simulate the user deleting the SKILL.md manually.
        unlinkSync(installed.installLocation)

        const stats = await synchronizeSkillsWithProvider(db, {
          userId: user.id,
          workspaceId: workspace.id,
          workspacePath,
          provider: makeFakeProvider([]), // provider sees nothing
        })

        expect(stats.healthyCount).toBe(0)
        expect(stats.missingOnDiskCount).toBe(1)
        expect(stats.externalDiscoveredCount).toBe(0)

        const reread = findInstalledSkillById(db, installed.id)
        expect(reread?.installHealth).toBe('missing-on-disk')
      })
    })
  })

  it('inserts an external row when the provider sees a skill not in our DB', async () => {
    await withFsAndDb(async (workspacePath, withDb) => {
      await withDb(async (db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id, workspacePath))

        const stats = await synchronizeSkillsWithProvider(db, {
          userId: user.id,
          workspaceId: workspace.id,
          workspacePath,
          provider: makeFakeProvider([
            {
              providerId: 'claude',
              scope: 'user',
              skillName: 'random-cli-skill',
              displayDescription: 'installed via raw Claude Code',
              installLocation: '/external/path/random-cli-skill/SKILL.md',
              invocationSyntax: '/random-cli-skill',
            },
          ]),
        })

        expect(stats.healthyCount).toBe(0)
        expect(stats.externalDiscoveredCount).toBe(1)

        const list = listInstalledSkillsForUserAndWorkspace(db, {
          userId: user.id,
          workspaceId: workspace.id,
        })
        expect(list).toHaveLength(1)
        expect(list[0]!.installedFromSource).toBe('external')
        expect(list[0]!.skillId).toBe('random-cli-skill')
        expect(list[0]!.versionInstalled).toBe('unknown')
      })
    })
  })

  it('rolls plugin-scope discoveries up to workspace-scope', async () => {
    await withFsAndDb(async (workspacePath, withDb) => {
      await withDb(async (db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id, workspacePath))

        await synchronizeSkillsWithProvider(db, {
          userId: user.id,
          workspaceId: workspace.id,
          workspacePath,
          provider: makeFakeProvider([
            {
              providerId: 'claude',
              scope: 'plugin',
              skillName: 'plugin-skill',
              displayDescription: null,
              installLocation: '/plugins/p/SKILL.md',
              invocationSyntax: '/plugin-skill',
            },
          ]),
        })

        const list = listInstalledSkillsForUserAndWorkspace(db, {
          userId: user.id,
          workspaceId: workspace.id,
        })
        expect(list[0]!.scope).toBe('workspace')
        expect(list[0]!.workspaceId).toBe(workspace.id)
      })
    })
  })
})
