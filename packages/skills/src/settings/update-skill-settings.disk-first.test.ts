// D8 for settings (2026-08-26): the SKILL.md re-render happens BEFORE the
// settings transaction, so a render that fails leaves the stored settings
// exactly as they were — never a row that claims values the file never got.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { withHomeDir } from '../internal/resolve-host-home-dir.js'
import { installSkill } from '../lifecycle/install-skill.js'
import { updateSkillSettings } from './update-skill-settings.js'
import * as skillSettingsRepository from '../repositories/index.js'

describe('updateSkillSettings — disk first', () => {
  it('leaves stored settings untouched when the SKILL.md render cannot happen', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'vynel-settings-disk-first-'))
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
          const installed = await installSkill(db, {
            userId: user.id,
            workspaceId: null,
            workspacePath: null,
            skillId: 'email-drafter',
            scope: 'user',
            initialSettings: { tonePreference: 'casual' },
          })
          const before = skillSettingsRepository.listSettingsForInstalledSkill(db, installed.id)
          expect(before.map((row) => [row.settingKey, row.settingValue])).toEqual([
            ['tonePreference', '"casual"'],
          ])

          // Replace the skill folder with a FILE of the same name: the render's
          // mkdir cannot succeed, so the update must fail before the tx.
          const skillFolder = join(homeDir, '.claude', 'skills', 'email-drafter')
          rmSync(skillFolder, { recursive: true, force: true })
          writeFileSync(skillFolder, 'not a folder', 'utf8')

          await expect(
            updateSkillSettings(db, {
              userId: user.id,
              installedSkillId: installed.id,
              newSettings: { tonePreference: 'warm' },
            }),
          ).rejects.toThrow()

          const after = skillSettingsRepository.listSettingsForInstalledSkill(db, installed.id)
          expect(after.map((row) => [row.settingKey, row.settingValue])).toEqual([
            ['tonePreference', '"casual"'],
          ])
        })
      })
    } finally {
      rmSync(homeDir, { recursive: true, force: true })
    }
  })
})
