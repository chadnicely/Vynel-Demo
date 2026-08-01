// Integration tests for `updateSkillSettings`.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { NotFoundError, ValidationError } from '@vynel/errors'
import { createHash } from 'node:crypto'
import JSZip from 'jszip'
import { installSkill } from '../lifecycle/install-skill.js'
import { installCloudSkill } from '../lifecycle/install-cloud-skill.js'
import { updateSkillSettings } from './update-skill-settings.js'
import { withHomeDir } from '../internal/resolve-host-home-dir.js'
import { SKILL_SETTINGS_UPDATED } from '../skills-events.js'

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

async function withFsAndDb<T>(
  fn: (workspacePath: string, dbRunner: typeof withTestDatabase) => Promise<T>,
): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'vynel-update-settings-test-'))
  try {
    return await withHomeDir(dir, () => fn(dir, withTestDatabase))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('updateSkillSettings', () => {
  it('persists new settings + re-renders SKILL.md', async () => {
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
          initialSettings: { defaultSignOff: 'Best,' },
        })

        const resolved = await updateSkillSettings(db, {
          userId: user.id,
          installedSkillId: installed.id,
          newSettings: { defaultSignOff: 'Cheers,', tonePreference: 'casual' },
        })

        expect(resolved.defaultSignOff).toBe('Cheers,')
        expect(resolved.tonePreference).toBe('casual')

        const content = await readFile(installed.installLocation, 'utf8')
        expect(content).toContain('Default sign-off: Cheers,')
        expect(content).toContain('Tone: casual')

        const events = listOutboxEventsByType(db, SKILL_SETTINGS_UPDATED)
        expect(events).toHaveLength(1)
        const payload = events[0]!.payload as { changedSettingKeys: string[] }
        expect(payload.changedSettingKeys.sort()).toEqual(
          ['defaultSignOff', 'tonePreference'].sort(),
        )
      })
    })
  })

  it('persists settings for a marketplace row WITHOUT clobbering its cloud bytes', async () => {
    await withFsAndDb(async (workspacePath, withDb) => {
      await withDb(async (db) => {
        const user = insertUser(db, makeUser())
        insertWorkspace(db, makeWorkspace(user.id, workspacePath))
        // email-drafter is a bundled∩cloud id — the case the guard exists
        // for: a marketplace-sourced install whose skillId also resolves a
        // bundled template definition.
        const zip = new JSZip()
        zip.file('SKILL.md', '# Email Drafter — CLOUD v9')
        const bytes = await zip.generateAsync({ type: 'nodebuffer' })
        const installed = await installCloudSkill(db, {
          userId: user.id,
          workspaceId: null,
          workspacePath: null,
          itemId: 'email-drafter',
          scope: 'user',
          artifactBytes: bytes,
          expectedSha256: createHash('sha256').update(bytes).digest('hex'),
          version: '9.0.0',
        })

        const resolved = await updateSkillSettings(db, {
          userId: user.id,
          installedSkillId: installed.id,
          newSettings: { defaultSignOff: 'Cheers,' },
        })
        expect(resolved.defaultSignOff).toBe('Cheers,')

        // The cloud artifact's bytes survive — no bundled-template render.
        const content = await readFile(installed.installLocation, 'utf8')
        expect(content).toBe('# Email Drafter — CLOUD v9')
      })
    })
  })

  it('throws ValidationError on unknown setting key', async () => {
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
        await expect(
          updateSkillSettings(db, {
            userId: user.id,
            installedSkillId: installed.id,
            newSettings: { unknownKey: 'orphan' },
          }),
        ).rejects.toBeInstanceOf(ValidationError)
      })
    })
  })

  it('throws ValidationError on out-of-range value', async () => {
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
        await expect(
          updateSkillSettings(db, {
            userId: user.id,
            installedSkillId: installed.id,
            newSettings: { defaultSignOff: '' }, // minLength:1 violated
          }),
        ).rejects.toBeInstanceOf(ValidationError)
      })
    })
  })

  it('throws NotFoundError when another user owns the row', async () => {
    await withFsAndDb(async (workspacePath, withDb) => {
      await withDb(async (db) => {
        const owner = insertUser(db, makeUser())
        const other = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(owner.id, workspacePath))
        const installed = await installSkill(db, {
          userId: owner.id,
          workspaceId: workspace.id,
          workspacePath,
          skillId: 'email-drafter',
          scope: 'user',
        })
        await expect(
          updateSkillSettings(db, {
            userId: other.id,
            installedSkillId: installed.id,
            newSettings: { defaultSignOff: 'X' },
          }),
        ).rejects.toBeInstanceOf(NotFoundError)
      })
    })
  })
})
