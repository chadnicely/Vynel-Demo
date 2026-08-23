// Integration tests for `POST /workspaces/:workspaceId/github/repository` —
// the full stack over a REAL `GitHubConnection` with a scripted runner: the
// workspace folder reaches gh as `--source`, and every way it can fail is a
// 200 with a reason, never a 500.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { GitHubConnection } from '@vynel/github'
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

function seedWorkspace(db: Db, userId: string) {
  const now = new Date()
  return insertWorkspace(db, {
    id: randomUUID(),
    userId,
    name: 'Front of House',
    managerName: null,
    kind: 'personal',
    path: `E:\\work\\${randomUUID()}`,
    groupId: null,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
}

function connection(signedIn: boolean, calls: string[][]) {
  return new GitHubConnection({
    runCommand: async (_file, args) => {
      calls.push(args)
      if (args[0] === 'auth') {
        if (signedIn)
          return { stdout: '✓ Logged in to github.com account sam (keyring)', stderr: '' }
        throw Object.assign(new Error('exit 1'), { stdout: '', stderr: 'not logged in' })
      }
      return { stdout: 'https://github.com/sam/front-of-house\n', stderr: '' }
    },
  })
}

function post(app: ReturnType<typeof createApp>, workspaceId: string, body: unknown) {
  return app.request(`/workspaces/${workspaceId}/github/repository`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /workspaces/:workspaceId/github/repository', () => {
  it('creates through gh with the workspace folder as the source', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)
      const calls: string[][] = []
      const app = createApp({ db, logger: silentLogger, githubConnection: connection(true, calls) })

      const res = await post(app, workspace.id, { name: 'front-of-house', visibility: 'private' })

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        outcome: { kind: 'created', url: 'https://github.com/sam/front-of-house' },
      })
      expect(calls[1]).toEqual([
        'repo',
        'create',
        'front-of-house',
        '--private',
        '--source',
        workspace.path,
        '--remote',
        'origin',
        '--push',
      ])
    })
  })

  it('answers a failed outcome, not a 5xx, when gh is signed out', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)
      const app = createApp({ db, logger: silentLogger, githubConnection: connection(false, []) })

      const res = await post(app, workspace.id, { name: 'front-of-house', visibility: 'public' })

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        outcome: { kind: 'failed', reason: 'Sign in to GitHub first (Settings → GitHub).' },
      })
    })
  })

  it("400s a name gh would misread, and 404s a workspace that is not the user's", async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)
      const app = createApp({ db, logger: silentLogger, githubConnection: connection(true, []) })

      expect((await post(app, workspace.id, { name: '-bad', visibility: 'private' })).status).toBe(
        400,
      )
      expect((await post(app, workspace.id, { name: 'ok', visibility: 'secret' })).status).toBe(400)
      expect((await post(app, randomUUID(), { name: 'ok', visibility: 'private' })).status).toBe(
        404,
      )
    })
  })
})
