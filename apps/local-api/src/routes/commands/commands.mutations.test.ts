// The `/commands` write doors over the full HTTP stack — real temp home dir
// (skills host-home seam) + temp workspace dir + real SQLite. Under guard:
// PUT renders the parts into frontmatter + body at both scopes (a
// namespaced name round-trips through the encoded path param), the
// nullable parts map to "absent", a save keeps a hand-authored file's extra
// frontmatter keys, DELETE removes the file and 404s once gone, the scope ↔
// workspaceId pairing (400 / 404), and the safe-name wall (400).

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
import type { CommandRow } from './serializers.js'

const silentLogger = pino({ level: 'silent' })

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
  const homeDir = mkdtempSync(join(tmpdir(), 'vynel-commands-mut-home-'))
  const workspaceDir = mkdtempSync(join(tmpdir(), 'vynel-commands-mut-ws-'))
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

function putCommand(app: ReturnType<typeof createApp>, commandName: string, body: unknown) {
  return app.request(`/commands/${encodeURIComponent(commandName)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('PUT /commands/:commandName', () => {
  it('renders the parts into a user-scope file and reads it back', async () => {
    await withWorld(async ({ app, homeDir }) => {
      const response = await putCommand(app, 'review', {
        scope: 'user',
        description: 'Review a PR',
        argumentHint: '[pr]',
        body: 'Review PR $ARGUMENTS carefully.',
      })
      expect(response.status).toBe(200)
      expect((await response.json()) as CommandRow).toMatchObject({
        commandName: 'review',
        relativePath: 'review.md',
        description: 'Review a PR',
        argumentHint: '[pr]',
        body: 'Review PR $ARGUMENTS carefully.\n',
        scope: 'user',
      })
      expect(readFileSync(join(homeDir, '.claude', 'commands', 'review.md'), 'utf8')).toBe(
        '---\ndescription: "Review a PR"\nargument-hint: "[pr]"\n---\n\nReview PR $ARGUMENTS carefully.\n',
      )
    })
  })

  it('a namespaced name round-trips through the encoded path param into a subfolder', async () => {
    await withWorld(async ({ app, workspaceDir, workspaceId }) => {
      const response = await putCommand(app, 'git:commit', {
        scope: 'workspace',
        workspaceId,
        description: null,
        body: 'Commit the work.',
      })
      expect(response.status).toBe(200)
      const row = (await response.json()) as CommandRow
      expect(row).toMatchObject({
        commandName: 'git:commit',
        relativePath: 'git/commit.md',
        description: null,
        argumentHint: null,
        scope: 'workspace',
      })
      expect(readFileSync(join(workspaceDir, '.claude', 'commands', 'git', 'commit.md'), 'utf8')).toBe(
        'Commit the work.\n',
      )
    })
  })

  it('keeps a hand-authored file\'s extra frontmatter keys on save', async () => {
    await withWorld(async ({ app, homeDir }) => {
      const commandsDir = join(homeDir, '.claude', 'commands')
      mkdirSync(commandsDir, { recursive: true })
      writeFileSync(
        join(commandsDir, 'deploy.md'),
        '---\nallowed-tools: Bash(git:*)\ndescription: Old\n---\nDeploy.\n',
        'utf8',
      )
      const response = await putCommand(app, 'deploy', {
        scope: 'user',
        description: 'Deploy to production',
        body: 'Deploy carefully.',
      })
      expect(response.status).toBe(200)
      expect(readFileSync(join(commandsDir, 'deploy.md'), 'utf8')).toBe(
        '---\ndescription: "Deploy to production"\nallowed-tools: Bash(git:*)\n---\n\nDeploy carefully.\n',
      )
    })
  })

  it('the user scope ignores an ambient workspaceId; the workspace scope requires one; unsafe names are 400', async () => {
    await withWorld(async ({ app, homeDir, workspaceDir, workspaceId }) => {
      const stamped = await putCommand(app, 'everywhere', { scope: 'user', workspaceId, body: 'x' })
      expect(stamped.status).toBe(200)
      expect(existsSync(join(homeDir, '.claude', 'commands', 'everywhere.md'))).toBe(true)
      expect(existsSync(join(workspaceDir, '.claude', 'commands', 'everywhere.md'))).toBe(false)

      expect((await putCommand(app, 'room', { scope: 'workspace', body: 'x' })).status).toBe(400)
      expect(
        (await putCommand(app, 'room', { scope: 'workspace', workspaceId: randomUUID(), body: 'x' }))
          .status,
      ).toBe(404)
      expect((await putCommand(app, '..:escape', { scope: 'user', body: 'x' })).status).toBe(400)
      expect((await putCommand(app, 'blank', { scope: 'user', body: '   ' })).status).toBe(400)
    })
  })
})

describe('DELETE /commands/:commandName', () => {
  it('removes the file at the named scope and 404s once gone', async () => {
    await withWorld(async ({ app, workspaceDir, workspaceId }) => {
      await putCommand(app, 'git:push', { scope: 'workspace', workspaceId, body: 'Push.' })
      const first = await app.request(
        `/commands/${encodeURIComponent('git:push')}?scope=workspace&workspaceId=${workspaceId}`,
        { method: 'DELETE' },
      )
      expect(first.status).toBe(204)
      expect(existsSync(join(workspaceDir, '.claude', 'commands', 'git'))).toBe(false)

      const second = await app.request(
        `/commands/${encodeURIComponent('git:push')}?scope=workspace&workspaceId=${workspaceId}`,
        { method: 'DELETE' },
      )
      expect(second.status).toBe(404)
      expect((await app.request('/commands/nope?scope=user', { method: 'DELETE' })).status).toBe(404)
    })
  })
})
