// Integration tests for BOTH `commands` twins — full HTTP stack over a real
// temp home dir (skills host-home seam) + temp workspace dir. Under guard:
// frontmatter surfacing, subfolder namespacing, and the user ∪ workspace
// fusion with scope chips on the workspace twin.

import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
  const homeDir = mkdtempSync(join(tmpdir(), 'vynel-commands-routes-home-'))
  const workspaceDir = mkdtempSync(join(tmpdir(), 'vynel-commands-routes-ws-'))
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

describe('user-scoped /commands', () => {
  it('lists commands with frontmatter fields and subfolder namespacing', async () => {
    await withWorld(async ({ app, homeDir }) => {
      const commandsDir = join(homeDir, '.claude', 'commands')
      mkdirSync(join(commandsDir, 'git'), { recursive: true })
      writeFileSync(
        join(commandsDir, 'review.md'),
        '---\ndescription: Review a PR\nargument-hint: "[pr]"\n---\n\nReview it.\n',
        'utf8',
      )
      writeFileSync(join(commandsDir, 'git', 'commit.md'), 'Commit the work.\n', 'utf8')

      const res = await app.request('/commands')
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        commands: [
          {
            commandName: 'git:commit',
            relativePath: 'git/commit.md',
            description: null,
            argumentHint: null,
            bodyPreview: 'Commit the work.',
            scope: 'user',
          },
          {
            commandName: 'review',
            relativePath: 'review.md',
            description: 'Review a PR',
            argumentHint: '[pr]',
            bodyPreview: 'Review it.',
            scope: 'user',
          },
        ],
      })
    })
  })

  it('answers an empty list when the folder does not exist', async () => {
    await withWorld(async ({ app }) => {
      const res = await app.request('/commands')
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ commands: [] })
    })
  })
})

describe('workspace-scoped /workspaces/:workspaceId/commands', () => {
  // SPEC CHANGE (2026-08-03): the two questions were split. `GET /` is the
  // MENU's read and must mirror the workspace's own folder on disk, so a
  // user-level command no longer appears there (listing one invited managing a
  // global file from a room that doesn't own it). `GET /resolved` is what the
  // composer's "/" picker asks — everything runnable here — and keeps the union,
  // because settingSources really does load both.
  it('lists only the workspace’s own commands', async () => {
    await withWorld(async ({ app, homeDir, workspaceDir, workspaceId }) => {
      const userCommands = join(homeDir, '.claude', 'commands')
      const wsCommands = join(workspaceDir, '.claude', 'commands')
      mkdirSync(userCommands, { recursive: true })
      mkdirSync(wsCommands, { recursive: true })
      writeFileSync(join(userCommands, 'everywhere.md'), 'Global command.\n', 'utf8')
      writeFileSync(join(wsCommands, 'here-only.md'), 'Room command.\n', 'utf8')

      const res = await app.request(`/workspaces/${workspaceId}/commands`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { commands: { commandName: string; scope: string }[] }
      expect(body.commands.map((command) => [command.commandName, command.scope])).toEqual([
        ['here-only', 'workspace'],
      ])
    })
  })

  it('fuses user ∪ workspace commands on /resolved, with scope chips', async () => {
    await withWorld(async ({ app, homeDir, workspaceDir, workspaceId }) => {
      const userCommands = join(homeDir, '.claude', 'commands')
      const wsCommands = join(workspaceDir, '.claude', 'commands')
      mkdirSync(userCommands, { recursive: true })
      mkdirSync(wsCommands, { recursive: true })
      writeFileSync(join(userCommands, 'everywhere.md'), 'Global command.\n', 'utf8')
      writeFileSync(join(wsCommands, 'here-only.md'), 'Room command.\n', 'utf8')

      const res = await app.request(`/workspaces/${workspaceId}/commands/resolved`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { commands: { commandName: string; scope: string }[] }
      expect(body.commands.map((command) => [command.commandName, command.scope])).toEqual([
        ['everywhere', 'user'],
        ['here-only', 'workspace'],
      ])
    })
  })

  it('404s an unknown workspace', async () => {
    await withWorld(async ({ app }) => {
      expect((await app.request(`/workspaces/${randomUUID()}/commands`)).status).toBe(404)
    })
  })
})
