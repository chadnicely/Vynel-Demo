// Integration tests for both `section-counts` twins — full HTTP stack over a
// real SQLite temp file, mounted at the real prefixes so the workspace
// resolver runs.
//
// The point of these pins: a count must agree with what OPENING the row
// shows. So they assert the curation (archived / soft-deleted / hidden swap
// segments are excluded, sibling scopes stay out, a scope counts what it
// OWNS) rather than just "a number came back".
//
// Sessions counts ENTRIES via `selectSessionsForScope` — the same predicate
// the library renders — so a continuity chain counts once.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { withTestDatabase } from '@vynel/testing'
import { VynelError } from '@vynel/errors'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { insertChatSession, type NewChatSession } from '@vynel/chat/repositories'
import { insertAgent } from '@vynel/db/repositories/agents'
import type { Database } from '@vynel/db'
import type { AppEnv } from '../../factory.js'
import type { AiAgentProvider } from '@vynel/providers'
import { sectionCountsApp } from './index.js'
import { sectionCountsWorkspaceApp } from './workspace-scoped.js'

const silentLogger = pino({ level: 'silent' })

type CountsBody = {
  counts: {
    sessions: number
    agents: number
    skills: number
    rules: number
    commands: number
    apps?: number
  }
}

function makeHarness(db: Database) {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('db', db)
    c.set('logger', silentLogger)
    // The skills count syncs the shelf with disk through the provider's
    // discovery (2026-08-26); the harness has no provider, so a silent one.
    c.set('aiProvider', {
      discoverInstalledSkills: async () => [],
    } as unknown as AiAgentProvider)
    c.set('appRequest', app.request.bind(app))
    await next()
  })
  app.onError((err, c) => {
    if (err instanceof VynelError) {
      return c.json({ code: err.code, message: err.message }, err.httpStatus as ContentfulStatusCode)
    }
    c.var.logger.error({ err }, 'unhandled error')
    return c.json({ code: 'internal_error', message: 'Internal server error.' }, 500)
  })
  app.route('/workspaces/:workspaceId/section-counts', sectionCountsWorkspaceApp)
  app.route('/section-counts', sectionCountsApp)
  return app
}

function seedUser(db: Database) {
  const now = new Date()
  return insertUser(db, {
    id: randomUUID(),
    displayName: 'Dana',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  })
}

function seedWorkspace(db: Database, userId: string) {
  const now = new Date()
  return insertWorkspace(db, {
    id: randomUUID(),
    userId,
    name: 'Acme',
    kind: 'small-business',
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
}

function seedSession(
  db: Database,
  userId: string,
  workspaceId: string | null,
  overrides: Partial<NewChatSession> = {},
) {
  const now = new Date()
  return insertChatSession(db, {
    id: `session-${randomUUID()}`,
    userId,
    workspaceId,
    providerId: 'claude',
    model: 'claude-opus-4-8',
    title: 'Session',
    isArchived: false,
    deletedAt: null,
    totalMessageCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    startedAt: now,
    lastMessageAt: now,
    updatedAt: now,
    ...overrides,
  })
}

function seedAgent(db: Database, userId: string, workspaceId: string | null, slug: string) {
  const now = new Date()
  return insertAgent(db, {
    id: randomUUID(),
    userId,
    workspaceId,
    slug,
    name: slug,
    description: 'A helper.',
    icon: null,
    prompt: 'Do the thing.',
    model: null,
    effort: null,
    permissionMode: null,
    background: false,
    allowedTools: null,
    disallowedTools: null,
    scope: workspaceId === null ? 'user' : 'workspace',
    source: 'user',
    trustTier: 'community',
    enabled: true,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  })
}

describe('GET /workspaces/:workspaceId/section-counts', () => {
  it("counts only the workspace's own conversations — siblings and global stay out", async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)
      const sibling = seedWorkspace(db, user.id)
      seedSession(db, user.id, workspace.id)
      seedSession(db, user.id, workspace.id)
      seedSession(db, user.id, sibling.id)
      seedSession(db, user.id, null)

      const res = await makeHarness(db).request(`/workspaces/${workspace.id}/section-counts`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as CountsBody
      expect(body.counts.sessions).toBe(2)
    })
  })

  it('excludes archived, soft-deleted and hidden sessions — the library hides them too', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)
      seedSession(db, user.id, workspace.id)
      seedSession(db, user.id, workspace.id, { isArchived: true })
      seedSession(db, user.id, workspace.id, { deletedAt: new Date() })
      seedSession(db, user.id, workspace.id, { visibility: 'hidden' })

      const res = await makeHarness(db).request(`/workspaces/${workspace.id}/section-counts`)
      const body = (await res.json()) as CountsBody
      expect(body.counts.sessions).toBe(1)
    })
  })

  it('reports apps at workspace scope, and zeroes for the empty sections', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)

      const res = await makeHarness(db).request(`/workspaces/${workspace.id}/section-counts`)
      const body = (await res.json()) as CountsBody
      expect(body.counts).toMatchObject({ sessions: 0, agents: 0, skills: 0, apps: 0 })
      // The workspace folder does not exist on disk — a missing rules folder
      // contributes nothing rather than throwing.
      expect(body.counts.rules).toBe(0)
    })
  })

  it('counts what the scope OWNS, not what merely resolves in it', async () => {
    // Without this, an empty DB makes every agent/skill assertion 0 and
    // dropping `ownedByWorkspaceOnly` from count-sections.ts passes silently.
    // The menu row lists the owned set, so the number must too.
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)
      seedAgent(db, user.id, null, 'user-scope-helper')
      seedAgent(db, user.id, workspace.id, 'workspace-helper')

      const app = makeHarness(db)
      const scoped = (await (
        await app.request(`/workspaces/${workspace.id}/section-counts`)
      ).json()) as CountsBody
      // 1, not 2: the user-scope agent resolves in a session here but is the
      // GLOBAL menu's row, not this workspace's.
      expect(scoped.counts.agents).toBe(1)

      const global = (await (await app.request('/section-counts')).json()) as CountsBody
      expect(global.counts.agents).toBe(1)
    })
  })

  it('404s on a workspace the user does not own', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const res = await makeHarness(db).request(`/workspaces/${randomUUID()}/section-counts`)
      expect(res.status).toBe(404)
    })
  })
})

describe('GET /section-counts', () => {
  it("counts what the GLOBAL library lists — only the root's own children", async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)
      seedSession(db, user.id, null, { scope: 'spawned' }) // listed in Global
      seedSession(db, user.id, null, { scope: 'global' }) // the Assistant brain — the Chat nav
      seedSession(db, user.id, workspace.id) // belongs to its room

      const res = await makeHarness(db).request('/section-counts')
      expect(res.status).toBe(200)
      const body = (await res.json()) as CountsBody
      expect(body.counts.sessions).toBe(1)
      expect(body.counts.apps).toBeUndefined()
    })
  })
})
