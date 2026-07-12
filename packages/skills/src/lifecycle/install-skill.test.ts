// Integration tests for `installSkill`. Real SQLite + real
// filesystem via `os.tmpdir()`. No mocking.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  findInstalledSkillById,
  findInstalledSkillByScope,
  listSettingsForInstalledSkill,
} from '../repositories/index.js'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { NotFoundError, ConflictError, ValidationError } from '@vynel/errors'
import { installSkill } from './install-skill.js'
import { withHomeDir } from '../internal/resolve-host-home-dir.js'
import { SKILL_INSTALLED } from '../skills-events.js'

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
  const dir = mkdtempSync(join(tmpdir(), 'vynel-install-skill-test-'))
  try {
    return await withHomeDir(dir, () => fn(dir, withTestDatabase))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('installSkill', () => {
  it('writes SKILL.md + persists row + settings + outbox event', async () => {
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
          initialSettings: {
            defaultSignOff: 'Cheers,',
            tonePreference: 'warm',
          },
        })

        // Row persisted.
        expect(installed.skillId).toBe('email-drafter')
        expect(installed.scope).toBe('user')
        expect(installed.isEnabled).toBe(true)
        expect(installed.installHealth).toBe('healthy')

        // Settings persisted.
        const settings = listSettingsForInstalledSkill(db, installed.id)
        const byKey = Object.fromEntries(
          settings.map((s) => [s.settingKey, JSON.parse(s.settingValue)]),
        )
        expect(byKey.defaultSignOff).toBe('Cheers,')
        expect(byKey.tonePreference).toBe('warm')

        // SKILL.md on disk has rendered settings.
        expect(existsSync(installed.installLocation)).toBe(true)
        const content = await readFile(installed.installLocation, 'utf8')
        expect(content).toContain('Default sign-off: Cheers,')
        expect(content).toContain('Tone: warm')

        // Outbox event emitted with full payload.
        const events = listOutboxEventsByType(db, SKILL_INSTALLED)
        expect(events).toHaveLength(1)
        const payload = events[0]!.payload as Record<string, unknown>
        expect(payload.installedSkillId).toBe(installed.id)
        expect(payload.scope).toBe('user')
        expect(payload.skillId).toBe('email-drafter')
      })
    })
  })

  it('throws NotFoundError when skillId is not in the catalog', async () => {
    await withFsAndDb(async (workspacePath, withDb) => {
      await withDb(async (db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id, workspacePath))
        await expect(
          installSkill(db, {
            userId: user.id,
            workspaceId: workspace.id,
            workspacePath,
            skillId: 'no-such-skill',
            scope: 'user',
          }),
        ).rejects.toBeInstanceOf(NotFoundError)
      })
    })
  })

  it('throws ConflictError when re-installing at the same scope', async () => {
    await withFsAndDb(async (workspacePath, withDb) => {
      await withDb(async (db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id, workspacePath))
        await installSkill(db, {
          userId: user.id,
          workspaceId: workspace.id,
          workspacePath,
          skillId: 'email-drafter',
          scope: 'user',
        })
        await expect(
          installSkill(db, {
            userId: user.id,
            workspaceId: workspace.id,
            workspacePath,
            skillId: 'email-drafter',
            scope: 'user',
          }),
        ).rejects.toBeInstanceOf(ConflictError)
      })
    })
  })

  it('installs at USER scope with no workspace binding (the global marketplace path)', async () => {
    await withFsAndDb(async (_workspacePath, withDb) => {
      await withDb(async (db) => {
        const user = insertUser(db, makeUser())
        const installed = await installSkill(db, {
          userId: user.id,
          workspaceId: null,
          workspacePath: null,
          skillId: 'email-drafter',
          scope: 'user',
        })
        expect(installed.scope).toBe('user')
        expect(installed.workspaceId).toBeNull()
        // Persisted, not just returned — findable at the user scope.
        expect(
          findInstalledSkillByScope(db, {
            userId: user.id,
            workspaceId: null,
            skillId: 'email-drafter',
          })?.id,
        ).toBe(installed.id)
      })
    })
  })

  it('throws ValidationError for a workspace-scope install missing its workspace binding', async () => {
    await withFsAndDb(async (_workspacePath, withDb) => {
      await withDb(async (db) => {
        const user = insertUser(db, makeUser())
        await expect(
          installSkill(db, {
            userId: user.id,
            workspaceId: null,
            workspacePath: null,
            skillId: 'email-drafter',
            scope: 'workspace',
          }),
        ).rejects.toBeInstanceOf(ValidationError)
      })
    })
  })

  it('throws ValidationError when an initial setting violates its schema', async () => {
    await withFsAndDb(async (workspacePath, withDb) => {
      await withDb(async (db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id, workspacePath))
        await expect(
          installSkill(db, {
            userId: user.id,
            workspaceId: workspace.id,
            workspacePath,
            skillId: 'email-drafter',
            scope: 'user',
            initialSettings: { tonePreference: 'angry' }, // not in enum
          }),
        ).rejects.toBeInstanceOf(ValidationError)
      })
    })
  })

  it('allows cross-scope coexistence for the same (user, skill)', async () => {
    await withFsAndDb(async (workspacePath, withDb) => {
      await withDb(async (db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id, workspacePath))
        const userScope = await installSkill(db, {
          userId: user.id,
          workspaceId: workspace.id,
          workspacePath,
          skillId: 'email-drafter',
          scope: 'user',
        })
        const wsScope = await installSkill(db, {
          userId: user.id,
          workspaceId: workspace.id,
          workspacePath,
          skillId: 'email-drafter',
          scope: 'workspace',
        })
        expect(userScope.id).not.toBe(wsScope.id)
        expect(findInstalledSkillById(db, userScope.id)?.workspaceId).toBeNull()
        expect(findInstalledSkillById(db, wsScope.id)?.workspaceId).toBe(workspace.id)
      })
    })
  })
})
