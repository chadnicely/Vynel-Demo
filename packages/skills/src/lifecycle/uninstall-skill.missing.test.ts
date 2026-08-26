// A row whose folder is already gone can still be uninstalled — the disk
// step is skipped and the row leaves (the 2026-08-26 reviewer's regression:
// the containment check must not make a stale row permanent).

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { withHomeDir } from '../internal/resolve-host-home-dir.js'
import { uninstallSkill } from './uninstall-skill.js'
import * as installedSkillsRepository from '../repositories/index.js'

describe('uninstallSkill — missing on disk', () => {
  it('drops the row when its folder no longer exists, wherever the row pointed', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'vynel-uninstall-missing-'))
    const elsewhere = mkdtempSync(join(tmpdir(), 'vynel-uninstall-elsewhere-'))
    rmSync(elsewhere, { recursive: true, force: true })
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
          const row = installedSkillsRepository.insertInstalledSkill(db, {
            id: randomUUID(),
            userId: user.id,
            workspaceId: null,
            skillId: 'moved-away',
            scope: 'user',
            installedFromSource: 'external',
            versionInstalled: 'unknown',
            // A location outside the current skills root — a re-pointed home.
            installLocation: join(elsewhere, 'moved-away', 'SKILL.md'),
            installHealth: 'missing-on-disk',
            installHealthMessage: 'gone',
            installedAt: now,
            updatedAt: now,
          })
          await uninstallSkill(db, { userId: user.id, installedSkillId: row.id })
          expect(installedSkillsRepository.findInstalledSkillById(db, row.id)).toBeNull()
        })
      })
    } finally {
      rmSync(homeDir, { recursive: true, force: true })
    }
  })
})
