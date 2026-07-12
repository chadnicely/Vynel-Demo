// Repository integration tests for the `installed_skills` table. Real
// SQLite via the local `withTestDatabase` helper (per `foundation.md
// §2 row 12` — no DB mocking). Spec: blueprint §4.1.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  findInstalledSkillById,
  findInstalledSkillByScope,
  listInstalledSkillsForUserAndWorkspace,
  insertInstalledSkill,
  updateInstalledSkill,
  hardDeleteInstalledSkill,
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

describe('installed-skills repository', () => {
  describe('findInstalledSkillById', () => {
    it('returns the row when present', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const inserted = insertInstalledSkill(db, makeInstalledSkill(user.id, workspace.id))
        const found = findInstalledSkillById(db, inserted.id)
        expect(found?.id).toBe(inserted.id)
        expect(found?.skillId).toBe('email-drafter')
      })
    })

    it('returns null when no row matches', async () => {
      await withTestDatabase((db) => {
        expect(findInstalledSkillById(db, 'nonexistent')).toBeNull()
      })
    })
  })

  describe('findInstalledSkillByScope', () => {
    it('finds the user-scope row when workspaceId is null', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const inserted = insertInstalledSkill(db, makeInstalledSkill(user.id, null))
        const found = findInstalledSkillByScope(db, {
          userId: user.id,
          workspaceId: null,
          skillId: 'email-drafter',
        })
        expect(found?.id).toBe(inserted.id)
        expect(found?.workspaceId).toBeNull()
      })
    })

    it('finds the workspace-scope row when workspaceId is provided', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const inserted = insertInstalledSkill(db, makeInstalledSkill(user.id, workspace.id))
        const found = findInstalledSkillByScope(db, {
          userId: user.id,
          workspaceId: workspace.id,
          skillId: 'email-drafter',
        })
        expect(found?.id).toBe(inserted.id)
        expect(found?.workspaceId).toBe(workspace.id)
      })
    })

    it('returns null when no row matches the scope', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        expect(
          findInstalledSkillByScope(db, {
            userId: user.id,
            workspaceId: null,
            skillId: 'email-drafter',
          }),
        ).toBeNull()
      })
    })

    it('distinguishes user-scope from workspace-scope for the same (user, skill)', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const userScope = insertInstalledSkill(db, makeInstalledSkill(user.id, null))
        const wsScope = insertInstalledSkill(db, makeInstalledSkill(user.id, workspace.id))

        const foundUser = findInstalledSkillByScope(db, {
          userId: user.id,
          workspaceId: null,
          skillId: 'email-drafter',
        })
        const foundWs = findInstalledSkillByScope(db, {
          userId: user.id,
          workspaceId: workspace.id,
          skillId: 'email-drafter',
        })
        expect(foundUser?.id).toBe(userScope.id)
        expect(foundWs?.id).toBe(wsScope.id)
      })
    })
  })

  describe('listInstalledSkillsForUserAndWorkspace', () => {
    it('returns user-scope + workspace-scope rows for the given workspace', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        insertInstalledSkill(db, makeInstalledSkill(user.id, null, { skillId: 'a' }))
        insertInstalledSkill(db, makeInstalledSkill(user.id, workspace.id, { skillId: 'b' }))

        const list = listInstalledSkillsForUserAndWorkspace(db, {
          userId: user.id,
          workspaceId: workspace.id,
        })
        expect(list.map((r) => r.skillId).sort()).toEqual(['a', 'b'])
      })
    })

    it('returns user-scope rows ONLY when workspaceId is null (the global-surface read)', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        insertInstalledSkill(db, makeInstalledSkill(user.id, null, { skillId: 'a' }))
        insertInstalledSkill(db, makeInstalledSkill(user.id, workspace.id, { skillId: 'b' }))

        const list = listInstalledSkillsForUserAndWorkspace(db, {
          userId: user.id,
          workspaceId: null,
        })
        expect(list.map((r) => r.skillId)).toEqual(['a'])
      })
    })

    it('excludes workspace-scope rows from other workspaces', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspaceA = insertWorkspace(db, makeWorkspace(user.id))
        const workspaceB = insertWorkspace(db, makeWorkspace(user.id))
        insertInstalledSkill(db, makeInstalledSkill(user.id, workspaceA.id, { skillId: 'a' }))
        insertInstalledSkill(db, makeInstalledSkill(user.id, workspaceB.id, { skillId: 'b' }))

        const list = listInstalledSkillsForUserAndWorkspace(db, {
          userId: user.id,
          workspaceId: workspaceA.id,
        })
        expect(list.map((r) => r.skillId)).toEqual(['a'])
      })
    })

    it('excludes rows from other users', async () => {
      await withTestDatabase((db) => {
        const userA = insertUser(db, makeUser())
        const userB = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(userA.id))
        insertInstalledSkill(db, makeInstalledSkill(userA.id, null, { skillId: 'a' }))
        insertInstalledSkill(db, makeInstalledSkill(userB.id, null, { skillId: 'b' }))

        const list = listInstalledSkillsForUserAndWorkspace(db, {
          userId: userA.id,
          workspaceId: workspace.id,
        })
        expect(list.map((r) => r.skillId)).toEqual(['a'])
      })
    })

    it('orders by installedAt DESC', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const t0 = new Date(2026, 4, 1).getTime()
        insertInstalledSkill(
          db,
          makeInstalledSkill(user.id, null, {
            skillId: 'oldest',
            installedAt: new Date(t0),
            updatedAt: new Date(t0),
          }),
        )
        insertInstalledSkill(
          db,
          makeInstalledSkill(user.id, workspace.id, {
            skillId: 'middle',
            installedAt: new Date(t0 + 1000),
            updatedAt: new Date(t0 + 1000),
          }),
        )
        insertInstalledSkill(
          db,
          makeInstalledSkill(user.id, null, {
            skillId: 'newest',
            installedAt: new Date(t0 + 2000),
            updatedAt: new Date(t0 + 2000),
          }),
        )

        const list = listInstalledSkillsForUserAndWorkspace(db, {
          userId: user.id,
          workspaceId: workspace.id,
        })
        expect(list.map((r) => r.skillId)).toEqual(['newest', 'middle', 'oldest'])
      })
    })

    it('returns empty array when no rows exist', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        expect(
          listInstalledSkillsForUserAndWorkspace(db, {
            userId: user.id,
            workspaceId: workspace.id,
          }),
        ).toEqual([])
      })
    })
  })
})
