// The top-level `/skills` doors over the full HTTP stack — real temp home
// dir (skills host-home seam) + temp workspace dir + real SQLite + the real
// provider discovery (scanning the seam's home, never the developer's).
// Under guard: the shelf syncs with disk on read (a hand-dropped folder
// appears; a deleted one turns "missing"), create writes a loadable
// SKILL.md and a user-sourced row, get/write/delete round-trip supporting
// files, uninstall removes folder + row, and the scope ↔ workspaceId
// pairing.

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { withHomeDir } from '@vynel/skills/test-support'
import type { Database } from '@vynel/db'
import { createApp } from '../../app.js'

const silentLogger = pino({ level: 'silent' })

type ShelfRow = { skillId: string; scope: string; installedFromSource: string; installHealth: string }
type FilesResponse = {
  skillId: string
  files: { relativePath: string; isText: boolean }[]
  file: { relativePath: string; content: string }
}

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
  return insertWorkspace(db, {
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
}

async function withWorld<T>(
  fn: (ctx: {
    app: ReturnType<typeof createApp>
    homeDir: string
    workspaceDir: string
    workspaceId: string
  }) => Promise<T>,
): Promise<T> {
  const homeDir = mkdtempSync(join(tmpdir(), 'vynel-skills-files-home-'))
  const workspaceDir = mkdtempSync(join(tmpdir(), 'vynel-skills-files-ws-'))
  try {
    return await withTestDatabase(async (db) => {
      const workspace = seedWorld(db, workspaceDir)
      const app = createApp({ db, logger: silentLogger })
      return withHomeDir(homeDir, () =>
        fn({ app, homeDir, workspaceDir, workspaceId: workspace.id }),
      )
    })
  } finally {
    rmSync(homeDir, { recursive: true, force: true })
    rmSync(workspaceDir, { recursive: true, force: true })
  }
}

function jsonRequest(method: 'POST' | 'PUT', url: string, body: unknown) {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}

describe('the shelf syncs with disk', () => {
  it('a hand-dropped folder appears as external; a removed one turns missing-on-disk', async () => {
    await withWorld(async ({ app, homeDir, workspaceDir, workspaceId }) => {
      const folder = join(workspaceDir, '.claude', 'skills', 'hand-made')
      mkdirSync(folder, { recursive: true })
      writeFileSync(join(folder, 'SKILL.md'), '---\nname: hand-made\ndescription: d\n---\nx\n', 'utf8')
      mkdirSync(join(homeDir, '.claude', 'skills', 'global-one'), { recursive: true })
      writeFileSync(
        join(homeDir, '.claude', 'skills', 'global-one', 'SKILL.md'),
        '---\nname: global-one\ndescription: d\n---\nx\n',
        'utf8',
      )

      const owned = (await (await app.request(`/workspaces/${workspaceId}/skills/installed`)).json()) as ShelfRow[]
      expect(owned.map((row) => [row.skillId, row.scope, row.installedFromSource])).toEqual([
        ['hand-made', 'workspace', 'external'],
      ])
      const global = (await (await app.request('/skills/installed')).json()) as ShelfRow[]
      expect(global.map((row) => [row.skillId, row.installedFromSource])).toEqual([
        ['global-one', 'external'],
      ])

      rmSync(folder, { recursive: true, force: true })
      const after = (await (await app.request(`/workspaces/${workspaceId}/skills/installed`)).json()) as ShelfRow[]
      expect(after.map((row) => [row.skillId, row.installHealth])).toEqual([
        ['hand-made', 'missing-on-disk'],
      ])
    })
  })
})

describe('POST /skills + the file doors', () => {
  it('creates, reads, writes a supporting file, deletes it, and uninstalls — at workspace scope', async () => {
    await withWorld(async ({ app, workspaceDir, workspaceId }) => {
      const created = await app.request(
        '/skills',
        jsonRequest('POST', '/skills', {
          scope: 'workspace',
          workspaceId,
          skillId: 'recipe-box',
          description: 'Find and format recipes',
          body: 'Look it up.',
        }),
      )
      expect(created.status).toBe(201)
      expect(await created.json()).toMatchObject({
        skillId: 'recipe-box',
        scope: 'workspace',
        installedFromSource: 'user',
      })
      const skillMarkdown = join(workspaceDir, '.claude', 'skills', 'recipe-box', 'SKILL.md')
      expect(readFileSync(skillMarkdown, 'utf8')).toBe(
        '---\nname: recipe-box\ndescription: "Find and format recipes"\n---\n\nLook it up.\n',
      )
      expect((await app.request('/skills', jsonRequest('POST', '/skills', {
        scope: 'workspace',
        workspaceId,
        skillId: 'recipe-box',
        description: 'again',
        body: 'x',
      }))).status).toBe(409)

      const written = await app.request(
        '/skills/recipe-box/files',
        jsonRequest('PUT', '', {
          scope: 'workspace',
          workspaceId,
          relativePath: 'references/units.md',
          content: '# Units\n',
        }),
      )
      expect(written.status).toBe(200)
      const writtenBody = (await written.json()) as FilesResponse
      expect(writtenBody.files.map((file) => file.relativePath)).toEqual([
        'SKILL.md',
        'references/units.md',
      ])
      expect(writtenBody.file).toEqual({ relativePath: 'references/units.md', content: '# Units\n' })

      const opened = await app.request(
        `/skills/recipe-box/files?scope=workspace&workspaceId=${workspaceId}`,
      )
      expect(opened.status).toBe(200)
      expect(((await opened.json()) as FilesResponse).file.relativePath).toBe('SKILL.md')

      const badEntry = await app.request(
        '/skills/recipe-box/files',
        jsonRequest('PUT', '', {
          scope: 'workspace',
          workspaceId,
          relativePath: 'SKILL.md',
          content: '# lost the frontmatter',
        }),
      )
      expect(badEntry.status).toBe(400)
      const escape = await app.request(
        '/skills/recipe-box/files',
        jsonRequest('PUT', '', {
          scope: 'workspace',
          workspaceId,
          relativePath: '../escape.md',
          content: 'x',
        }),
      )
      expect(escape.status).toBe(400)

      const deleted = await app.request(
        `/skills/recipe-box/files?scope=workspace&workspaceId=${workspaceId}&relativePath=${encodeURIComponent('references/units.md')}`,
        { method: 'DELETE' },
      )
      expect(deleted.status).toBe(204)
      expect(existsSync(join(workspaceDir, '.claude', 'skills', 'recipe-box', 'references'))).toBe(false)
      const deleteEntry = await app.request(
        `/skills/recipe-box/files?scope=workspace&workspaceId=${workspaceId}&relativePath=SKILL.md`,
        { method: 'DELETE' },
      )
      expect(deleteEntry.status).toBe(400)

      const uninstalled = await app.request(
        `/skills/recipe-box?scope=workspace&workspaceId=${workspaceId}`,
        { method: 'DELETE' },
      )
      expect(uninstalled.status).toBe(204)
      expect(existsSync(join(workspaceDir, '.claude', 'skills', 'recipe-box'))).toBe(false)
      const shelf = (await (await app.request(`/workspaces/${workspaceId}/skills/installed`)).json()) as ShelfRow[]
      expect(shelf).toEqual([])
      expect(
        (await app.request(`/skills/recipe-box?scope=workspace&workspaceId=${workspaceId}`, {
          method: 'DELETE',
        })).status,
      ).toBe(404)
    })
  })

  it('user scope lands in the home folder; the workspace scope needs its id; unknown skills 404', async () => {
    await withWorld(async ({ app, homeDir }) => {
      const created = await app.request(
        '/skills',
        jsonRequest('POST', '', { scope: 'user', skillId: 'everywhere', description: 'd', body: 'b' }),
      )
      expect(created.status).toBe(201)
      expect(existsSync(join(homeDir, '.claude', 'skills', 'everywhere', 'SKILL.md'))).toBe(true)

      expect(
        (await app.request('/skills', jsonRequest('POST', '', { scope: 'workspace', skillId: 'x', description: 'd', body: 'b' }))).status,
      ).toBe(400)
      expect((await app.request('/skills/nope/files?scope=user')).status).toBe(404)
      expect(
        (await app.request('/skills', jsonRequest('POST', '', { scope: 'user', skillId: 'Not Kebab', description: 'd', body: 'b' }))).status,
      ).toBe(400)
    })
  })
})
