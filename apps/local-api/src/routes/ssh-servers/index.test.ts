// Integration tests for the USER-scoped `/ssh-servers/...` routes. Full HTTP
// stack: route -> validator -> userScoped -> core op -> repo -> SQLite (real,
// via withTestDatabase). The test-connection path runs against the leaf's
// REAL loopback ssh2 server — no mocks anywhere.
//
// TENANT-ISOLATION ordering invariant: the Phase-1 resolver returns the FIRST
// user row (`findSingleLocalUser` = limit(1)), so the "attacker" (the resolved
// local user) is `insertUser`'d BEFORE the victim's rows.

import { describe, expect, it } from 'vitest'
import { randomBytes, randomUUID } from 'node:crypto'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { seedUserWorkspace, startFakeSshServer } from '@vynel/ssh-servers/test-support'
import { createApp } from '../../app.js'
import type { Database } from '@vynel/db'

const silentLogger = pino({ level: 'silent' })

// A real 32-byte sealing key — the shape server.ts resolves from the keyring.
const masterKeyBase64 = randomBytes(32).toString('base64')

function jsonBody(method: string, payload: unknown): RequestInit {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }
}

function makeUser() {
  const now = new Date()
  return {
    id: randomUUID(),
    displayName: 'Dana',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  }
}

function seedWorkspace(db: Database, userId: string) {
  const now = new Date()
  return insertWorkspace(db, {
    id: randomUUID(),
    userId,
    name: 'Bakery',
    kind: 'small-business',
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
}

function addServerBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    scope: 'global',
    name: 'My web server',
    host: '127.0.0.1',
    username: 'dana',
    credentials: { authKind: 'password', password: 'sourdough' },
    ...overrides,
  }
}

describe('ssh-servers routes', () => {
  it('POST / registers global + workspace servers; NO response ever carries the credential', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger, sealingMasterKeyBase64: masterKeyBase64 })
      const user = insertUser(db, makeUser())
      const workspace = seedWorkspace(db, user.id)

      const globalRes = await app.request('/ssh-servers', jsonBody('POST', addServerBody()))
      expect(globalRes.status).toBe(201)
      const globalServer = (await globalRes.json()) as Record<string, unknown>
      expect(globalServer.workspaceId).toBeNull()
      expect(globalServer.authKind).toBe('password')
      expect(globalServer.hostKeyFingerprint).toBeNull()
      // The stripping boundary: the sealed blob must not exist on the wire.
      expect(globalServer).not.toHaveProperty('encryptedCredentials')

      const workspaceRes = await app.request(
        '/ssh-servers',
        jsonBody(
          'POST',
          addServerBody({
            scope: 'workspace',
            workspaceId: workspace.id,
            name: 'Shop box',
          }),
        ),
      )
      expect(workspaceRes.status).toBe(201)
      const workspaceServer = (await workspaceRes.json()) as Record<string, unknown>
      expect(workspaceServer.workspaceId).toBe(workspace.id)
      expect(workspaceServer).not.toHaveProperty('encryptedCredentials')

      const list = await app.request('/ssh-servers')
      expect(list.status).toBe(200)
      const rows = (await list.json()) as Record<string, unknown>[]
      expect(rows.map((row) => row.name).sort()).toEqual(['My web server', 'Shop box'])
      for (const row of rows) expect(row).not.toHaveProperty('encryptedCredentials')
    })
  })

  it('POST / with scope:workspace requires workspaceId (400 without it)', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger, sealingMasterKeyBase64: masterKeyBase64 })
      insertUser(db, makeUser())

      const missing = await app.request(
        '/ssh-servers',
        jsonBody('POST', addServerBody({ scope: 'workspace' })),
      )
      expect(missing.status).toBe(400)
    })
  })

  it('DELETE /:serverId removes an owned server (204); the list empties', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger, sealingMasterKeyBase64: masterKeyBase64 })
      insertUser(db, makeUser())

      const created = await app.request('/ssh-servers', jsonBody('POST', addServerBody()))
      const server = (await created.json()) as { id: string }

      const deleted = await app.request(`/ssh-servers/${server.id}`, { method: 'DELETE' })
      expect(deleted.status).toBe(204)
      const list = (await (await app.request('/ssh-servers')).json()) as unknown[]
      expect(list).toHaveLength(0)
    })
  })

  it("404s identically on a missing server and another user's server", async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger, sealingMasterKeyBase64: masterKeyBase64 })
      insertUser(db, makeUser()) // attacker — resolved as the local user
      const victim = seedUserWorkspace(db)

      // The victim's server, inserted through the leaf op (owner = victim).
      const { addSshServer } = await import('@vynel/ssh-servers')
      const victimServer = addSshServer(
        db,
        {
          userId: victim.userId,
          workspaceId: null,
          name: 'Victim box',
          host: '127.0.0.1',
          username: 'dana',
          credentials: { authKind: 'password', password: 'sourdough' },
        },
        { masterKeyBase64 },
      )

      const missing = await app.request(`/ssh-servers/${randomUUID()}`, { method: 'DELETE' })
      const foreign = await app.request(`/ssh-servers/${victimServer.id}`, { method: 'DELETE' })
      expect(missing.status).toBe(404)
      expect(foreign.status).toBe(404)

      const foreignTest = await app.request(`/ssh-servers/${victimServer.id}/test-connection`, {
        method: 'POST',
      })
      expect(foreignTest.status).toBe(404)
    })
  })

  it('POST /:serverId/test-connection connects to a REAL loopback server, pins, and stays ok', async () => {
    await withTestDatabase(async (db) => {
      const fakeServer = await startFakeSshServer()
      try {
        const app = createApp({ db, logger: silentLogger, sealingMasterKeyBase64: masterKeyBase64 })
        insertUser(db, makeUser())

        const created = await app.request(
          '/ssh-servers',
          jsonBody('POST', addServerBody({ port: fakeServer.port })),
        )
        const server = (await created.json()) as { id: string }

        const first = await app.request(`/ssh-servers/${server.id}/test-connection`, {
          method: 'POST',
        })
        expect(first.status).toBe(200)
        const firstBody = (await first.json()) as { ok: boolean; hostKeyFingerprint: string }
        expect(firstBody.ok).toBe(true)
        expect(firstBody.hostKeyFingerprint.length).toBeGreaterThan(0)

        // The pin landed on the row and a second connect matches it (TOFU).
        const listed = (await (await app.request('/ssh-servers')).json()) as {
          hostKeyFingerprint: string | null
          lastConnectedAt: string | null
        }[]
        expect(listed[0]!.hostKeyFingerprint).toBe(firstBody.hostKeyFingerprint)
        expect(listed[0]!.lastConnectedAt).not.toBeNull()

        const second = await app.request(`/ssh-servers/${server.id}/test-connection`, {
          method: 'POST',
        })
        expect(second.status).toBe(200)
        expect(((await second.json()) as { ok: boolean }).ok).toBe(true)
      } finally {
        await fakeServer.close()
      }
    })
  })

  it('refuses to seal without a master key (createApp got none) — 409, actionable message', async () => {
    await withTestDatabase(async (db) => {
      // No sealingMasterKeyBase64 — the generator/test default. 409 stands in for
      // 503 (the closed error taxonomy has no 503 class; see the route's WHY).
      const app = createApp({ db, logger: silentLogger })
      insertUser(db, makeUser())

      const res = await app.request('/ssh-servers', jsonBody('POST', addServerBody()))
      expect(res.status).toBe(409)
      const body = (await res.json()) as { code: string; message: string }
      expect(body.code).toBe('conflict')
      expect(body.message).toContain('SSH is unavailable')
    })
  })
})
