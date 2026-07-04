// Repository integration tests for the `installed_skills` table —
// MUTATING operations (insert/update/hardDelete). Read tests live
// in the sibling `installed-skills.test.ts`. Split per
// structure-standard.md "File size cap" (code-reviewer C1).

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  findInstalledSkillById,
  insertInstalledSkill,
  updateInstalledSkill,
  hardDeleteInstalledSkill,
  listInstalledSkillsForUserAndWorkspace,
  type NewInstalledSkillRow,
} from './installed-skills.js'
import { upsertSkillSetting, listSettingsForInstalledSkill } from './skill-settings.js'

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

function makeWorkspace(userId: string) {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    name: 'Acme',
    kind: 'small-business' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }
}

function makeInstalledSkill(
  userId: string,
  workspaceId: string | null,
  overrides: Partial<NewInstalledSkillRow> = {},
): NewInstalledSkillRow {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    workspaceId,
    skillId: 'email-drafter',
    scope: workspaceId === null ? 'user' : 'workspace',
    installedFromSource: 'verified-catalog',
    versionInstalled: '1.0.0',
    installLocation: `/tmp/vynel/skills/${randomUUID()}/SKILL.md`,
    installHealth: 'healthy',
    installHealthMessage: null,
    isEnabled: true,
    installedAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('installed-skills repository — mutations', () => {
  describe('insertInstalledSkill', () => {
    it('persists every column + returns the row', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const newRow = makeInstalledSkill(user.id, workspace.id, {
          installHealthMessage: 'note: re-installed after sync detected missing-on-disk',
        })
        const inserted = insertInstalledSkill(db, newRow)
        expect(inserted.id).toBe(newRow.id)
        expect(inserted.skillId).toBe(newRow.skillId)
        expect(inserted.scope).toBe('workspace')
        expect(inserted.installHealthMessage).toBe(newRow.installHealthMessage)
        expect(inserted.isEnabled).toBe(true)
      })
    })

    it('rejects a duplicate (userId, workspaceId, skillId) at workspace scope', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        insertInstalledSkill(db, makeInstalledSkill(user.id, workspace.id))
        expect(() => insertInstalledSkill(db, makeInstalledSkill(user.id, workspace.id))).toThrow(
          /UNIQUE/i,
        )
      })
    })

    it('rejects two user-scope rows with the same (userId, skillId) via the partial unique index (D9)', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        insertInstalledSkill(db, makeInstalledSkill(user.id, null))
        expect(() => insertInstalledSkill(db, makeInstalledSkill(user.id, null))).toThrow(/UNIQUE/i)
      })
    })

    it('allows user-scope + workspace-scope for the same (userId, skillId)', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        insertInstalledSkill(db, makeInstalledSkill(user.id, null))
        insertInstalledSkill(db, makeInstalledSkill(user.id, workspace.id))
        const list = listInstalledSkillsForUserAndWorkspace(db, {
          userId: user.id,
          workspaceId: workspace.id,
        })
        expect(list).toHaveLength(2)
      })
    })
  })

  describe('updateInstalledSkill', () => {
    it('patches columns + touches updatedAt', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const inserted = insertInstalledSkill(db, makeInstalledSkill(user.id, null))
        const beforeUpdate = inserted.updatedAt.getTime()

        const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
        return sleep(5).then(() => {
          const updated = updateInstalledSkill(db, inserted.id, user.id, {
            isEnabled: false,
            installHealth: 'missing-on-disk',
            installHealthMessage: 'SKILL.md gone',
          })
          expect(updated?.isEnabled).toBe(false)
          expect(updated?.installHealth).toBe('missing-on-disk')
          expect(updated?.installHealthMessage).toBe('SKILL.md gone')
          expect(updated?.updatedAt.getTime()).toBeGreaterThan(beforeUpdate)
        })
      })
    })

    it('returns null when no row matches', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        expect(updateInstalledSkill(db, 'nonexistent', user.id, { isEnabled: false })).toBeNull()
      })
    })

    it('returns null when another user owns the row (tenant filter — C3)', async () => {
      await withTestDatabase((db) => {
        const owner = insertUser(db, makeUser())
        const other = insertUser(db, makeUser())
        const inserted = insertInstalledSkill(db, makeInstalledSkill(owner.id, null))
        expect(updateInstalledSkill(db, inserted.id, other.id, { isEnabled: false })).toBeNull()
        expect(findInstalledSkillById(db, inserted.id)?.isEnabled).toBe(true)
      })
    })
  })

  describe('hardDeleteInstalledSkill', () => {
    it('removes the row + returns true', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const inserted = insertInstalledSkill(db, makeInstalledSkill(user.id, null))
        expect(hardDeleteInstalledSkill(db, inserted.id, user.id)).toBe(true)
        expect(findInstalledSkillById(db, inserted.id)).toBeNull()
      })
    })

    it('returns false on re-call (idempotent)', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const inserted = insertInstalledSkill(db, makeInstalledSkill(user.id, null))
        expect(hardDeleteInstalledSkill(db, inserted.id, user.id)).toBe(true)
        expect(hardDeleteInstalledSkill(db, inserted.id, user.id)).toBe(false)
      })
    })

    it('returns false when another user owns the row (tenant filter — C3)', async () => {
      await withTestDatabase((db) => {
        const owner = insertUser(db, makeUser())
        const other = insertUser(db, makeUser())
        const inserted = insertInstalledSkill(db, makeInstalledSkill(owner.id, null))
        expect(hardDeleteInstalledSkill(db, inserted.id, other.id)).toBe(false)
        expect(findInstalledSkillById(db, inserted.id)).not.toBeNull()
      })
    })

    it('cascades skill_settings via the parent FK', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const inserted = insertInstalledSkill(db, makeInstalledSkill(user.id, null))
        upsertSkillSetting(db, {
          installedSkillId: inserted.id,
          settingKey: 'defaultSignOff',
          settingValue: JSON.stringify('Best,'),
        })
        expect(listSettingsForInstalledSkill(db, inserted.id)).toHaveLength(1)

        hardDeleteInstalledSkill(db, inserted.id, user.id)
        expect(listSettingsForInstalledSkill(db, inserted.id)).toHaveLength(0)
      })
    })
  })
})
