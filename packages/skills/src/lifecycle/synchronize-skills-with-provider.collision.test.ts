// The sync as a READ-PATH citizen, part two: no disk state may make it
// throw. A second folder carrying a frontmatter name a row already holds
// (a copied folder with its `name:` left alone) is skipped with a warning,
// the list keeps answering, and exactly one row exists for that name.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import type { AiAgentProvider } from '@vynel/providers'
import { withHomeDir } from '../internal/resolve-host-home-dir.js'
import { synchronizeSkillsWithProvider } from './synchronize-skills-with-provider.js'
import * as installedSkillsRepository from '../repositories/index.js'

function seedFolder(homeDir: string, folder: string, name: string): string {
  const skillFolder = join(homeDir, '.claude', 'skills', folder)
  mkdirSync(skillFolder, { recursive: true })
  const location = join(skillFolder, 'SKILL.md')
  writeFileSync(location, `---\nname: ${name}\ndescription: d\n---\nBody\n`, 'utf8')
  return location
}

describe('synchronizeSkillsWithProvider — same-name folders', () => {
  it('adopts the first folder, skips the copy, and a re-run stays quiet', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'vynel-sync-collision-'))
    try {
      await withTestDatabase(async (db) => {
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
        await withHomeDir(homeDir, async () => {
          const original = seedFolder(homeDir, 'recipe-box', 'recipe-box')
          const copy = seedFolder(homeDir, 'recipe-box-copy', 'recipe-box')
          const warnings: unknown[] = []
          const provider = {
            providerId: 'claude' as const,
            discoverInstalledSkills: async () =>
              [original, copy].map((installLocation) => ({
                providerId: 'claude' as const,
                scope: 'user' as const,
                skillName: 'recipe-box',
                displayDescription: 'd',
                installLocation,
                invocationSyntax: '/recipe-box',
              })),
          } as unknown as AiAgentProvider
          const logger = {
            info: () => undefined,
            warn: (...args: unknown[]) => {
              warnings.push(args)
            },
            error: () => undefined,
            debug: () => undefined,
          }

          const first = await synchronizeSkillsWithProvider(
            db,
            { userId: user.id, workspaceId: null, workspacePath: null, provider },
            { logger },
          )
          expect(first.externalDiscoveredCount).toBe(1)
          expect(warnings).toHaveLength(1)

          const second = await synchronizeSkillsWithProvider(
            db,
            { userId: user.id, workspaceId: null, workspacePath: null, provider },
            { logger },
          )
          expect(second).toEqual({ healthyCount: 1, missingOnDiskCount: 0, externalDiscoveredCount: 0 })
          const rows = installedSkillsRepository.listInstalledSkillsForUserAndWorkspace(db, {
            userId: user.id,
            workspaceId: null,
          })
          expect(rows.map((row) => row.installLocation)).toEqual([original])
        })
      })
    } finally {
      rmSync(homeDir, { recursive: true, force: true })
    }
  })
})
