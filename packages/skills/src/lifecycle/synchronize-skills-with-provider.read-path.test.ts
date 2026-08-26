// The sync as a READ-PATH citizen (it now runs on every skills list): a
// re-run with nothing changed writes nothing (no updatedAt churn), the
// global surface (no workspace) reconciles only user-scope rows and adopts
// only user-scope discoveries, and the provider is asked to scan the skills
// leaf's own home seam rather than the OS home.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import type { Database } from '@vynel/db'
import type { AiAgentProvider } from '@vynel/providers'
import { withHomeDir } from '../internal/resolve-host-home-dir.js'
import { synchronizeSkillsWithProvider } from './synchronize-skills-with-provider.js'
import * as installedSkillsRepository from '../repositories/index.js'

type Discovered = Awaited<ReturnType<AiAgentProvider['discoverInstalledSkills']>>

function makeRecordingProvider(skills: Discovered) {
  const calls: Parameters<AiAgentProvider['discoverInstalledSkills']>[0][] = []
  const provider = {
    providerId: 'claude' as const,
    discoverInstalledSkills: async (input: Parameters<AiAgentProvider['discoverInstalledSkills']>[0]) => {
      calls.push(input)
      return skills
    },
  } as unknown as AiAgentProvider
  return { provider, calls }
}

function seedWorld(db: Database, workspacePath: string) {
  const now = new Date()
  const user = insertUser(db, {
    id: randomUUID(),
    displayName: 'Dana',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: true,
    createdAt: now,
    updatedAt: now,
  })
  const workspace = insertWorkspace(db, {
    id: randomUUID(),
    userId: user.id,
    name: 'Bakery',
    kind: 'small-business',
    path: workspacePath,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
  return { user, workspace }
}

async function withWorld<T>(
  fn: (ctx: { db: Database; userId: string; workspaceId: string; homeDir: string; workspaceDir: string }) => Promise<T>,
): Promise<T> {
  const homeDir = mkdtempSync(join(tmpdir(), 'vynel-sync-read-home-'))
  const workspaceDir = mkdtempSync(join(tmpdir(), 'vynel-sync-read-ws-'))
  try {
    return await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db, workspaceDir)
      return withHomeDir(homeDir, () =>
        fn({ db, userId: user.id, workspaceId: workspace.id, homeDir, workspaceDir }),
      )
    })
  } finally {
    rmSync(homeDir, { recursive: true, force: true })
    rmSync(workspaceDir, { recursive: true, force: true })
  }
}

function seedSkillOnDisk(root: string, folder: string): string {
  const skillFolder = join(root, '.claude', 'skills', folder)
  mkdirSync(skillFolder, { recursive: true })
  const location = join(skillFolder, 'SKILL.md')
  writeFileSync(location, `---\nname: ${folder}\ndescription: d\n---\nBody\n`, 'utf8')
  return location
}

describe('synchronizeSkillsWithProvider — read path', () => {
  it('adopts a discovered skill once, then a re-run touches no row', async () => {
    await withWorld(async ({ db, userId, workspaceId, homeDir, workspaceDir }) => {
      const location = seedSkillOnDisk(homeDir, 'hand-made')
      const { provider, calls } = makeRecordingProvider([
        {
          providerId: 'claude',
          scope: 'user',
          skillName: 'hand-made',
          displayDescription: 'd',
          installLocation: location,
          invocationSyntax: '/hand-made',
        },
      ])

      const first = await synchronizeSkillsWithProvider(db, {
        userId,
        workspaceId,
        workspacePath: workspaceDir,
        provider,
      })
      expect(first).toEqual({ healthyCount: 0, missingOnDiskCount: 0, externalDiscoveredCount: 1 })
      expect(calls[0]).toEqual({ userHomeDir: homeDir, workspacePath: workspaceDir })

      const [row] = installedSkillsRepository.listInstalledSkillsForUserAndWorkspace(db, {
        userId,
        workspaceId,
      })
      const second = await synchronizeSkillsWithProvider(db, {
        userId,
        workspaceId,
        workspacePath: workspaceDir,
        provider,
      })
      expect(second).toEqual({ healthyCount: 1, missingOnDiskCount: 0, externalDiscoveredCount: 0 })
      const [after] = installedSkillsRepository.listInstalledSkillsForUserAndWorkspace(db, {
        userId,
        workspaceId,
      })
      expect(after!.updatedAt.getTime()).toBe(row!.updatedAt.getTime())
    })
  })

  it('the global surface (no workspace) reconciles user rows only and asks for no workspace path', async () => {
    await withWorld(async ({ db, userId, workspaceId, homeDir, workspaceDir }) => {
      const userLocation = seedSkillOnDisk(homeDir, 'global-one')
      const roomLocation = seedSkillOnDisk(workspaceDir, 'room-one')
      const { provider, calls } = makeRecordingProvider([
        {
          providerId: 'claude',
          scope: 'user',
          skillName: 'global-one',
          displayDescription: null,
          installLocation: userLocation,
          invocationSyntax: '/global-one',
        },
        // A provider handed a workspace hit anyway must not produce a row
        // that has no workspace to belong to.
        {
          providerId: 'claude',
          scope: 'workspace',
          skillName: 'room-one',
          displayDescription: null,
          installLocation: roomLocation,
          invocationSyntax: '/room-one',
        },
      ])

      const stats = await synchronizeSkillsWithProvider(db, {
        userId,
        workspaceId: null,
        workspacePath: null,
        provider,
      })
      expect(stats.externalDiscoveredCount).toBe(1)
      expect(calls[0]).toEqual({ userHomeDir: homeDir })
      const rows = installedSkillsRepository.listInstalledSkillsForUserAndWorkspace(db, {
        userId,
        workspaceId,
      })
      expect(rows.map((r) => [r.skillId, r.scope])).toEqual([['global-one', 'user']])
    })
  })
})
