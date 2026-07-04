// Integration tests for `uninstallSkill`. Real SQLite + real
// filesystem.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  findInstalledSkillById,
  listSettingsForInstalledSkill,
} from '../repositories/index.js'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { NotFoundError } from '@vynel/errors'
import { installSkill } from './install-skill.js'
import { uninstallSkill } from './uninstall-skill.js'
import { withHomeDir } from '../internal/resolve-host-home-dir.js'
import { SKILL_UNINSTALLED } from '../skills-events.js'

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
  const dir = mkdtempSync(join(tmpdir(), 'vynel-uninstall-test-'))
  try {
    return await withHomeDir(dir, () => fn(dir, withTestDatabase))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('uninstallSkill', () => {
  it('removes files + DB row (cascades settings) + emits outbox event', async () => {
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
        expect(existsSync(installed.installLocation)).toBe(true)
        expect(listSettingsForInstalledSkill(db, installed.id)).toHaveLength(1)

        await uninstallSkill(db, {
          userId: user.id,
          installedSkillId: installed.id,
        })

        expect(existsSync(installed.installLocation)).toBe(false)
        expect(findInstalledSkillById(db, installed.id)).toBeNull()
        expect(listSettingsForInstalledSkill(db, installed.id)).toHaveLength(0)

        const events = listOutboxEventsByType(db, SKILL_UNINSTALLED)
        expect(events).toHaveLength(1)
      })
    })
  })

  it('throws NotFoundError when the row does not exist', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      await expect(
        uninstallSkill(db, { userId: user.id, installedSkillId: 'nope' }),
      ).rejects.toBeInstanceOf(NotFoundError)
    })
  })

  it('throws NotFoundError when another user owns the row (no enumeration leak)', async () => {
    await withFsAndDb(async (workspacePath, withDb) => {
      await withDb(async (db) => {
        const ownerUser = insertUser(db, makeUser())
        const otherUser = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(ownerUser.id, workspacePath))
        const installed = await installSkill(db, {
          userId: ownerUser.id,
          workspaceId: workspace.id,
          workspacePath,
          skillId: 'email-drafter',
          scope: 'user',
        })

        await expect(
          uninstallSkill(db, { userId: otherUser.id, installedSkillId: installed.id }),
        ).rejects.toBeInstanceOf(NotFoundError) // NOT ForbiddenError — same 404
        // Row still exists (otherUser's call did not delete).
        expect(findInstalledSkillById(db, installed.id)).not.toBeNull()
      })
    })
  })

  // The "system-installed skills cannot be uninstalled" path (ForbiddenError,
  // skills D3) lost its only fixture when `workspace-context` was retired in A2 —
  // Phase 1 now ships NO system-installed skill, so there is nothing installable
  // to drive that branch through the public API. The guard is retained in
  // `uninstall-skill.ts`; it regains coverage when a future system bundle lands.
})
