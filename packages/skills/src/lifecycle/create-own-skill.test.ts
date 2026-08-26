// `createOwnSkill` over real SQLite + a real isolated home/workspace dir:
// the folder + SKILL.md land disk-first with a loadable frontmatter, the
// row is `user`-sourced and announced through the outbox, a second create
// (row or a stray folder) is refused, and the parts are validated.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import type { Database } from '@vynel/db'
import { withHomeDir } from '../internal/resolve-host-home-dir.js'
import { createOwnSkill } from './create-own-skill.js'
import { SKILL_INSTALLED } from '../skills-events.js'
import * as installedSkillsRepository from '../repositories/index.js'

function seedWorld(db: Database, workspacePath: string) {
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
  const workspace = insertWorkspace(db, {
    id: randomUUID(),
    userId: user.id,
    name: 'Bakery',
    kind: 'small-business',
    path: workspacePath,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
  return { user, workspace }
}

async function withWorld<T>(
  fn: (ctx: { db: Database; userId: string; workspaceId: string; homeDir: string; workspaceDir: string }) => Promise<T>,
): Promise<T> {
  const homeDir = mkdtempSync(join(tmpdir(), 'vynel-create-skill-home-'))
  const workspaceDir = mkdtempSync(join(tmpdir(), 'vynel-create-skill-ws-'))
  try {
    return await withTestDatabase(async (db) => {
      const { user, workspace } = seedWorld(db, workspaceDir)
      return withHomeDir(homeDir, () =>
        fn({ db, userId: user.id, workspaceId: workspace.id, homeDir, workspaceDir }),
      )
    })
  } finally {
    rmSync(homeDir, { recursive: true, force: true })
    rmSync(workspaceDir, { recursive: true, force: true })
  }
}

describe('createOwnSkill', () => {
  it('writes <root>/<id>/SKILL.md at user scope, inserts a user-sourced row, emits skill.installed', async () => {
    await withWorld(async ({ db, userId, homeDir }) => {
      const row = await createOwnSkill(db, {
        userId,
        workspaceId: null,
        workspacePath: null,
        scope: 'user',
        skillId: 'recipe-box',
        description: 'Find and format recipes',
        body: 'Look the recipe up, then format it as a card.',
      })
      const expectedLocation = join(homeDir, '.claude', 'skills', 'recipe-box', 'SKILL.md')
      expect(row).toMatchObject({
        skillId: 'recipe-box',
        scope: 'user',
        workspaceId: null,
        installedFromSource: 'user',
        installHealth: 'healthy',
        installLocation: expectedLocation,
      })
      expect(readFileSync(expectedLocation, 'utf8')).toBe(
        '---\nname: recipe-box\ndescription: "Find and format recipes"\n---\n\nLook the recipe up, then format it as a card.\n',
      )
      const events = listOutboxEventsByType(db, SKILL_INSTALLED)
      expect(events).toHaveLength(1)
      expect(events[0]!.payload).toMatchObject({ skillId: 'recipe-box', source: 'user' })
    })
  })

  it('workspace scope lands under the workspace and needs its binding', async () => {
    await withWorld(async ({ db, userId, workspaceId, workspaceDir }) => {
      const row = await createOwnSkill(db, {
        userId,
        workspaceId,
        workspacePath: workspaceDir,
        scope: 'workspace',
        skillId: 'room-only',
        description: 'Here',
        body: 'Body',
      })
      expect(row.workspaceId).toBe(workspaceId)
      expect(existsSync(join(workspaceDir, '.claude', 'skills', 'room-only', 'SKILL.md'))).toBe(true)

      await expect(
        createOwnSkill(db, {
          userId,
          workspaceId: null,
          workspacePath: null,
          scope: 'workspace',
          skillId: 'nowhere',
          description: 'x',
          body: 'y',
        }),
      ).rejects.toMatchObject({ code: 'validation_failed' })
    })
  })

  it('refuses a duplicate row, a stray folder on disk, and bad parts — leaving no row behind', async () => {
    await withWorld(async ({ db, userId, homeDir }) => {
      const input = {
        userId,
        workspaceId: null,
        workspacePath: null,
        scope: 'user' as const,
        skillId: 'twice',
        description: 'd',
        body: 'b',
      }
      await createOwnSkill(db, input)
      await expect(createOwnSkill(db, input)).rejects.toMatchObject({ code: 'conflict' })

      mkdirSync(join(homeDir, '.claude', 'skills', 'stray'), { recursive: true })
      await expect(createOwnSkill(db, { ...input, skillId: 'stray' })).rejects.toMatchObject({
        code: 'conflict',
      })

      for (const bad of [
        { skillId: 'Not Kebab' },
        { description: ' ' },
        { description: 'two\nlines' },
        { body: '   ' },
      ]) {
        await expect(
          createOwnSkill(db, { ...input, skillId: 'fresh', ...bad }),
        ).rejects.toMatchObject({ code: 'validation_failed' })
      }
      expect(
        installedSkillsRepository.findInstalledSkillByScope(db, {
          userId,
          workspaceId: null,
          skillId: 'fresh',
        }),
      ).toBeNull()
      expect(existsSync(join(homeDir, '.claude', 'skills', 'fresh'))).toBe(false)
    })
  })
})
