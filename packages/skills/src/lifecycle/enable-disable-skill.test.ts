// Integration tests for `enableSkill` + `disableSkill`. Real
// SQLite + real filesystem. Per D11 — disable removes files;
// enable rewrites them.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { findInstalledSkillById } from '../repositories/index.js'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { NotFoundError } from '@vynel/errors'
import { installSkill } from './install-skill.js'
import { enableSkill } from './enable-skill.js'
import { disableSkill } from './disable-skill.js'
import { withHomeDir } from '../internal/resolve-host-home-dir.js'
import { SKILL_ENABLED_CHANGED } from '../skills-events.js'

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
  const dir = mkdtempSync(join(tmpdir(), 'vynel-enable-disable-test-'))
  try {
    return await withHomeDir(dir, () => fn(dir, withTestDatabase))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('disable + enable cycle', () => {
  it('disable removes files + flips flag + emits outbox; enable rewrites + flips back', async () => {
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
        expect(existsSync(installed.installLocation)).toBe(true)

        const disabled = await disableSkill(db, {
          userId: user.id,
          installedSkillId: installed.id,
        })
        expect(disabled.isEnabled).toBe(false)
        expect(existsSync(installed.installLocation)).toBe(false)

        // Row + settings preserved.
        expect(findInstalledSkillById(db, installed.id)).not.toBeNull()

        const reenabled = await enableSkill(db, {
          userId: user.id,
          installedSkillId: installed.id,
        })
        expect(reenabled.isEnabled).toBe(true)
        expect(existsSync(installed.installLocation)).toBe(true)

        // 2 outbox events emitted (disable + enable).
        const events = listOutboxEventsByType(db, SKILL_ENABLED_CHANGED)
        expect(events).toHaveLength(2)
      })
    })
  })

  it('disable is a no-op when the skill is already disabled', async () => {
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
        await disableSkill(db, { userId: user.id, installedSkillId: installed.id })
        await disableSkill(db, { userId: user.id, installedSkillId: installed.id })

        const events = listOutboxEventsByType(db, SKILL_ENABLED_CHANGED)
        expect(events).toHaveLength(1) // only the first call emits
      })
    })
  })

  it("disable throws NotFoundError for another user's row", async () => {
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
          disableSkill(db, { userId: other.id, installedSkillId: installed.id }),
        ).rejects.toBeInstanceOf(NotFoundError)
      })
    })
  })
})
