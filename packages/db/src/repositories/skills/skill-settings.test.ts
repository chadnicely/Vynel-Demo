// Repository integration tests for the `skill_settings` table. Real
// SQLite via the local `withTestDatabase` helper (per `foundation.md
// §2 row 12` — no DB mocking). Spec: blueprint §4.2.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '../../test-support/with-test-database.js'
import { insertUser } from '../users/users.js'
import {
  listSettingsForInstalledSkill,
  upsertSkillSetting,
  deleteAllSettingsForInstalledSkill,
} from './skill-settings.js'
import { insertInstalledSkill, type NewInstalledSkillRow } from './installed-skills.js'

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

function makeInstalledSkill(userId: string): NewInstalledSkillRow {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    workspaceId: null,
    skillId: 'email-drafter',
    scope: 'user',
    installedFromSource: 'verified-catalog',
    versionInstalled: '1.0.0',
    installLocation: `/tmp/vynel/skills/${randomUUID()}/SKILL.md`,
    installHealth: 'healthy',
    installHealthMessage: null,
    isEnabled: true,
    installedAt: now,
    updatedAt: now,
  }
}

describe('skill-settings repository', () => {
  describe('listSettingsForInstalledSkill', () => {
    it('returns every key for the given installedSkillId', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const installed = insertInstalledSkill(db, makeInstalledSkill(user.id))
        upsertSkillSetting(db, {
          installedSkillId: installed.id,
          settingKey: 'defaultSignOff',
          settingValue: JSON.stringify('Best,'),
        })
        upsertSkillSetting(db, {
          installedSkillId: installed.id,
          settingKey: 'tonePreference',
          settingValue: JSON.stringify('warm'),
        })

        const list = listSettingsForInstalledSkill(db, installed.id)
        expect(list).toHaveLength(2)
        const byKey = Object.fromEntries(list.map((r) => [r.settingKey, r.settingValue]))
        expect(JSON.parse(byKey.defaultSignOff!)).toBe('Best,')
        expect(JSON.parse(byKey.tonePreference!)).toBe('warm')
      })
    })

    it('returns an empty array when no rows exist', async () => {
      await withTestDatabase((db) => {
        expect(listSettingsForInstalledSkill(db, 'nonexistent')).toEqual([])
      })
    })

    it('scopes by installedSkillId — other installations are not returned', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const a = insertInstalledSkill(db, makeInstalledSkill(user.id))
        const b = insertInstalledSkill(db, {
          ...makeInstalledSkill(user.id),
          skillId: 'other-skill',
        })
        upsertSkillSetting(db, {
          installedSkillId: a.id,
          settingKey: 'k',
          settingValue: JSON.stringify('a-value'),
        })
        upsertSkillSetting(db, {
          installedSkillId: b.id,
          settingKey: 'k',
          settingValue: JSON.stringify('b-value'),
        })

        const aList = listSettingsForInstalledSkill(db, a.id)
        expect(aList).toHaveLength(1)
        expect(JSON.parse(aList[0]!.settingValue)).toBe('a-value')
      })
    })
  })

  describe('upsertSkillSetting', () => {
    it('inserts a new row + returns it', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const installed = insertInstalledSkill(db, makeInstalledSkill(user.id))
        const row = upsertSkillSetting(db, {
          installedSkillId: installed.id,
          settingKey: 'defaultSignOff',
          settingValue: JSON.stringify('Cheers,'),
        })
        expect(row.installedSkillId).toBe(installed.id)
        expect(row.settingKey).toBe('defaultSignOff')
        expect(JSON.parse(row.settingValue)).toBe('Cheers,')
      })
    })

    it('updates an existing row + touches updatedAt', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const installed = insertInstalledSkill(db, makeInstalledSkill(user.id))
        const first = upsertSkillSetting(db, {
          installedSkillId: installed.id,
          settingKey: 'k',
          settingValue: JSON.stringify('v1'),
        })
        const firstAt = first.updatedAt.getTime()

        const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
        return sleep(5).then(() => {
          const second = upsertSkillSetting(db, {
            installedSkillId: installed.id,
            settingKey: 'k',
            settingValue: JSON.stringify('v2'),
          })
          expect(JSON.parse(second.settingValue)).toBe('v2')
          expect(second.updatedAt.getTime()).toBeGreaterThan(firstAt)

          const list = listSettingsForInstalledSkill(db, installed.id)
          expect(list).toHaveLength(1) // upsert, not duplicate insert
        })
      })
    })

    it('preserves other keys when one key is updated', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const installed = insertInstalledSkill(db, makeInstalledSkill(user.id))
        upsertSkillSetting(db, {
          installedSkillId: installed.id,
          settingKey: 'keep',
          settingValue: JSON.stringify('untouched'),
        })
        upsertSkillSetting(db, {
          installedSkillId: installed.id,
          settingKey: 'update',
          settingValue: JSON.stringify('v1'),
        })
        upsertSkillSetting(db, {
          installedSkillId: installed.id,
          settingKey: 'update',
          settingValue: JSON.stringify('v2'),
        })

        const list = listSettingsForInstalledSkill(db, installed.id)
        expect(list).toHaveLength(2)
        const byKey = Object.fromEntries(
          list.map((r) => [r.settingKey, JSON.parse(r.settingValue)]),
        )
        expect(byKey.keep).toBe('untouched')
        expect(byKey.update).toBe('v2')
      })
    })
  })

  describe('deleteAllSettingsForInstalledSkill', () => {
    it('removes every row for the installedSkillId', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const installed = insertInstalledSkill(db, makeInstalledSkill(user.id))
        upsertSkillSetting(db, {
          installedSkillId: installed.id,
          settingKey: 'a',
          settingValue: JSON.stringify(1),
        })
        upsertSkillSetting(db, {
          installedSkillId: installed.id,
          settingKey: 'b',
          settingValue: JSON.stringify(2),
        })
        expect(listSettingsForInstalledSkill(db, installed.id)).toHaveLength(2)

        deleteAllSettingsForInstalledSkill(db, installed.id)
        expect(listSettingsForInstalledSkill(db, installed.id)).toHaveLength(0)
      })
    })

    it('does not touch settings of other installations', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const a = insertInstalledSkill(db, makeInstalledSkill(user.id))
        const b = insertInstalledSkill(db, {
          ...makeInstalledSkill(user.id),
          skillId: 'other-skill',
        })
        upsertSkillSetting(db, {
          installedSkillId: a.id,
          settingKey: 'k',
          settingValue: JSON.stringify('a'),
        })
        upsertSkillSetting(db, {
          installedSkillId: b.id,
          settingKey: 'k',
          settingValue: JSON.stringify('b'),
        })

        deleteAllSettingsForInstalledSkill(db, a.id)
        expect(listSettingsForInstalledSkill(db, a.id)).toHaveLength(0)
        expect(listSettingsForInstalledSkill(db, b.id)).toHaveLength(1)
      })
    })
  })
})
