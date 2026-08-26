// Integration tests for `GET /workspaces/:workspaceId/git` — real git in a
// temp folder (the readers are worth little against a fake): a repository
// answers whole, a plain folder answers 'not-a-repository' with empty lists,
// and the owner-scoped resolver still 404s.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import type { WorkspaceGitResponse } from '@vynel/contracts/workspaces/workspace-git'
import { createApp } from '../../app.js'

const silentLogger = pino({ level: 'silent' })

type Db = Parameters<Parameters<typeof withTestDatabase>[0]>[0]

function seedUser(db: Db) {
  const now = new Date()
  return insertUser(db, {
    id: randomUUID(),
    displayName: 'T',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  })
}

function seedWorkspace(db: Db, userId: string, directory: string) {
  const now = new Date()
  return insertWorkspace(db, {
    id: randomUUID(),
    userId,
    name: 'Front of House',
    managerName: null,
    kind: 'personal',
    path: directory,
    groupId: null,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
}

function makeRepository(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'vynel-git-route-'))
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@localhost', ...args], {
      cwd: directory,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  git('init', '-q', '-b', 'main')
  writeFileSync(path.join(directory, 'README.md'), '# test\n')
  git('add', 'README.md')
  git('commit', '-q', '-m', 'first')
  writeFileSync(path.join(directory, 'notes.txt'), 'untracked\n')
  return directory
}

describe('GET /workspaces/:workspaceId/git', () => {
  it('answers a repository with its facts, branches and worktrees', async () => {
    const directory = makeRepository()
    try {
      await withTestDatabase(async (db) => {
        const user = seedUser(db)
        const workspace = seedWorkspace(db, user.id, directory)
        const app = createApp({ db, logger: silentLogger })

        const res = await app.request(`/workspaces/${workspace.id}/git`)

        expect(res.status).toBe(200)
        const body = (await res.json()) as WorkspaceGitResponse
        expect(body.facts).toEqual({
          kind: 'repository',
          branch: 'main',
          upstream: null,
          ahead: null,
          behind: null,
          changedCount: 0,
          untrackedCount: 1,
          remoteUrl: null,
        })
        expect(body.branches).toEqual([{ name: 'main', isCurrent: true, upstream: null }])
        expect(body.worktrees).toHaveLength(1)
        expect(body.worktrees[0]).toMatchObject({ branch: 'main', isMain: true })
      })
    } finally {
      rmSync(directory, { recursive: true, force: true, maxRetries: 3 })
    }
  })

  it('answers a plain folder as not-a-repository with empty lists — never a 4xx', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'vynel-plain-route-'))
    try {
      await withTestDatabase(async (db) => {
        const user = seedUser(db)
        const workspace = seedWorkspace(db, user.id, directory)
        const app = createApp({ db, logger: silentLogger })

        const res = await app.request(`/workspaces/${workspace.id}/git`)

        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({
          facts: { kind: 'not-a-repository' },
          branches: [],
          worktrees: [],
        })
      })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('404s for a workspace that does not exist (owner-scoped resolver)', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const app = createApp({ db, logger: silentLogger })

      const res = await app.request(`/workspaces/${randomUUID()}/git`)

      expect(res.status).toBe(404)
    })
  })

  describe('GET /workspaces/:workspaceId/setup', () => {
    it("reads the folder's repository, env KEY NAMES, and database — never a value", async () => {
      await withTestDatabase(async (db) => {
        const directory = mkdtempSync(path.join(tmpdir(), 'vynel-setup-route-'))
        try {
          writeFileSync(
            path.join(directory, 'package.json'),
            JSON.stringify({ dependencies: { 'better-sqlite3': '^11' } }),
          )
          writeFileSync(path.join(directory, '.env'), 'DATABASE_URL=postgres://secret\nAPI_KEY=sk-1')
          const user = seedUser(db)
          const workspace = seedWorkspace(db, user.id, directory)
          const app = createApp({ db, logger: silentLogger })

          const res = await app.request(`/workspaces/${workspace.id}/setup`)
          expect(res.status).toBe(200)
          const body = (await res.json()) as {
            env: { kind: string; keyNames?: string[] }
            database: string | null
            databaseIsLocal: boolean
          }
          expect(body.env.kind).toBe('present')
          expect(body.env.keyNames).toEqual(['DATABASE_URL', 'API_KEY'])
          // The values never leave the folder.
          expect(JSON.stringify(body)).not.toContain('secret')
          expect(JSON.stringify(body)).not.toContain('sk-1')
          expect(body.database).toBe('SQLite')
          expect(body.databaseIsLocal).toBe(true)
        } finally {
          rmSync(directory, { recursive: true, force: true })
        }
      })
    })
  })
})
