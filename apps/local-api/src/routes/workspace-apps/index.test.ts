// Integration tests for the `/workspaces/:workspaceId/apps` routes. Full HTTP
// stack + the REAL process supervisor (injected so the test can inspect it and
// stop everything after) spawning real `node -e` children — no mocks.
//
// TENANT-ISOLATION ordering invariant: the Phase-1 resolver returns the FIRST
// user row, so the "attacker" is `insertUser`'d BEFORE the victim's rows.

import { describe, expect, it, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { AppProcessSupervisor } from '@vynel/apps'
import { insertApp, makeApp, seedUserWorkspace } from '@vynel/apps/test-support'
import { createApp } from '../../app.js'
import type { Database } from '@vynel/db'

const silentLogger = pino({ level: 'silent' })

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

// A real on-disk workspace dir — the supervisor spawns with it as cwd.
function seedWorkspace(db: Database, userId: string) {
  const now = new Date()
  return insertWorkspace(db, {
    id: randomUUID(),
    userId,
    name: 'Bakery',
    kind: 'small-business',
    path: mkdtempSync(join(tmpdir(), 'vynel-apps-route-')),
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
}

const supervisors: AppProcessSupervisor[] = []
function makeSupervisor(): AppProcessSupervisor {
  const supervisor = new AppProcessSupervisor()
  supervisors.push(supervisor)
  return supervisor
}
afterEach(async () => {
  await Promise.all(supervisors.splice(0).map((s) => s.stopAll()))
})

function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolvePoll, rejectPoll) => {
    const startedAt = Date.now()
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer)
        resolvePoll()
      } else if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer)
        rejectPoll(new Error('waitFor timed out'))
      }
    }, 50)
  })
}

describe('workspace-apps routes', () => {
  it('POST / registers; GET / lists with null runtime before any run', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger, appSupervisor: makeSupervisor() })
      const user = insertUser(db, makeUser())
      const workspace = seedWorkspace(db, user.id)

      const res = await app.request(
        `/workspaces/${workspace.id}/apps`,
        jsonBody('POST', { name: 'Echo', command: 'node -e ""', port: 8999 }),
      )
      expect(res.status).toBe(201)

      const list = (await (
        await app.request(`/workspaces/${workspace.id}/apps`)
      ).json()) as { name: string; runtime: unknown }[]
      expect(list).toHaveLength(1)
      expect(list[0]!.name).toBe('Echo')
      expect(list[0]!.runtime).toBeNull()
    })
  })

  it('start → logs → stop drives a REAL process and publishes runtime events', async () => {
    await withTestDatabase(async (db) => {
      const supervisor = makeSupervisor()
      const app = createApp({ db, logger: silentLogger, appSupervisor: supervisor })
      const user = insertUser(db, makeUser())
      const workspace = seedWorkspace(db, user.id)
      const row = insertApp(
        db,
        makeApp(user.id, workspace.id, {
          name: 'Server',
          command: `node -e "console.log('server up'); setInterval(() => {}, 1000)"`,
          cwdRelative: '',
        }),
      )

      const started = await app.request(`/workspaces/${workspace.id}/apps/${row.id}/start`, {
        method: 'POST',
      })
      expect(started.status).toBe(200)
      expect(
        ((await started.json()) as { runtime: { status: string } }).runtime.status,
      ).toBe('running')
      expect(listOutboxEventsByType(db, 'app.started')).toHaveLength(1)

      // A second start conflicts while running.
      const again = await app.request(`/workspaces/${workspace.id}/apps/${row.id}/start`, {
        method: 'POST',
      })
      expect(again.status).toBe(409)

      await waitFor(() => supervisor.logsOf(row.id).join('\n').includes('server up'))
      const logs = (await (
        await app.request(`/workspaces/${workspace.id}/apps/${row.id}/logs?tail=50`)
      ).json()) as { lines: string[] }
      expect(logs.lines.join('\n')).toContain('server up')

      const stopped = await app.request(`/workspaces/${workspace.id}/apps/${row.id}/stop`, {
        method: 'POST',
      })
      expect(stopped.status).toBe(200)
      expect(
        ((await stopped.json()) as { runtime: { status: string } }).runtime.status,
      ).toBe('exited')
      expect(listOutboxEventsByType(db, 'app.stopped')).toHaveLength(1)

      // Stopping again is a harmless no-op — no second event.
      await app.request(`/workspaces/${workspace.id}/apps/${row.id}/stop`, { method: 'POST' })
      expect(listOutboxEventsByType(db, 'app.stopped')).toHaveLength(1)
    })
  })

  it('DELETE stops a running app first, then removes the row', async () => {
    await withTestDatabase(async (db) => {
      const supervisor = makeSupervisor()
      const app = createApp({ db, logger: silentLogger, appSupervisor: supervisor })
      const user = insertUser(db, makeUser())
      const workspace = seedWorkspace(db, user.id)
      const row = insertApp(
        db,
        makeApp(user.id, workspace.id, {
          command: `node -e "setInterval(() => {}, 1000)"`,
          cwdRelative: '',
        }),
      )

      await app.request(`/workspaces/${workspace.id}/apps/${row.id}/start`, { method: 'POST' })
      expect(supervisor.isRunning(row.id)).toBe(true)

      const removed = await app.request(`/workspaces/${workspace.id}/apps/${row.id}`, {
        method: 'DELETE',
      })
      expect(removed.status).toBe(204)
      expect(supervisor.isRunning(row.id)).toBe(false)
      const list = (await (await app.request(`/workspaces/${workspace.id}/apps`)).json()) as unknown[]
      expect(list).toHaveLength(0)
    })
  })

  it("404s on another user's app and on a same-user app through the WRONG workspace", async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger, appSupervisor: makeSupervisor() })
      const attacker = insertUser(db, makeUser())
      const attackerWorkspaceA = seedWorkspace(db, attacker.id)
      const attackerWorkspaceB = seedWorkspace(db, attacker.id)
      const victim = seedUserWorkspace(db)
      const victimApp = insertApp(db, makeApp(victim.userId, victim.workspaceId))
      const ownApp = insertApp(db, makeApp(attacker.id, attackerWorkspaceA.id))

      const foreign = await app.request(
        `/workspaces/${attackerWorkspaceA.id}/apps/${victimApp.id}/start`,
        { method: 'POST' },
      )
      expect(foreign.status).toBe(404)

      // Workspace binding: the attacker's OWN app through the wrong workspace URL.
      const crossWorkspace = await app.request(
        `/workspaces/${attackerWorkspaceB.id}/apps/${ownApp.id}/start`,
        { method: 'POST' },
      )
      expect(crossWorkspace.status).toBe(404)
    })
  })

  describe('the env editor (GET/PUT /:appId/env — user-only, no x-mcp)', () => {
    it('reads a missing file as exists:false, then round-trips a PUT line-preservingly', async () => {
      await withTestDatabase(async (db) => {
        const app = createApp({ db, logger: silentLogger, appSupervisor: makeSupervisor() })
        const user = insertUser(db, makeUser())
        const workspace = seedWorkspace(db, user.id)
        const row = insertApp(db, makeApp(user.id, workspace.id))

        const empty = (await (
          await app.request(`/workspaces/${workspace.id}/apps/${row.id}/env`)
        ).json()) as { envFileRelative: string; exists: boolean; entries: unknown[] }
        expect(empty).toEqual({ envFileRelative: '.env', exists: false, entries: [] })

        // A pre-existing file with a comment — the PUT must keep it.
        writeFileSync(join(workspace.path, '.env'), '# secrets live here\nOLD_KEY=gone\n')

        const put = await app.request(
          `/workspaces/${workspace.id}/apps/${row.id}/env`,
          jsonBody('PUT', {
            entries: [
              { key: 'DATABASE_URL', value: 'postgres://localhost/dev' },
              { key: 'API_KEY', value: 'abc123' },
            ],
          }),
        )
        expect(put.status).toBe(200)
        const saved = (await put.json()) as { exists: boolean; entries: { key: string }[] }
        expect(saved.exists).toBe(true)
        expect(saved.entries.map((e) => e.key)).toEqual(['DATABASE_URL', 'API_KEY'])

        // Comment preserved, removed key gone, on the REAL file.
        expect(readFileSync(join(workspace.path, '.env'), 'utf8')).toBe(
          '# secrets live here\nDATABASE_URL=postgres://localhost/dev\nAPI_KEY=abc123\n',
        )
      })
    })

    it("honors the app's folder + a custom envFileRelative set at registration", async () => {
      await withTestDatabase(async (db) => {
        const app = createApp({ db, logger: silentLogger, appSupervisor: makeSupervisor() })
        const user = insertUser(db, makeUser())
        const workspace = seedWorkspace(db, user.id)
        mkdirSync(join(workspace.path, 'apps', 'web'), { recursive: true })

        const created = (await (
          await app.request(
            `/workspaces/${workspace.id}/apps`,
            jsonBody('POST', {
              name: 'Web',
              command: 'npm run dev',
              cwdRelative: 'apps/web',
              envFileRelative: '.env.local',
            }),
          )
        ).json()) as { id: string; envFileRelative: string }
        expect(created.envFileRelative).toBe('.env.local')

        const put = await app.request(
          `/workspaces/${workspace.id}/apps/${created.id}/env`,
          jsonBody('PUT', { entries: [{ key: 'PORT', value: '3000' }] }),
        )
        expect(put.status).toBe(200)
        expect(readFileSync(join(workspace.path, 'apps', 'web', '.env.local'), 'utf8')).toBe(
          'PORT=3000\n',
        )
      })
    })

    it('rejects an escaping env path at registration and bad entries at PUT (400s)', async () => {
      await withTestDatabase(async (db) => {
        const app = createApp({ db, logger: silentLogger, appSupervisor: makeSupervisor() })
        const user = insertUser(db, makeUser())
        const workspace = seedWorkspace(db, user.id)

        const escape = await app.request(
          `/workspaces/${workspace.id}/apps`,
          jsonBody('POST', { name: 'Sneaky', command: 'x', envFileRelative: '../outside.env' }),
        )
        expect(escape.status).toBe(400)

        const row = insertApp(db, makeApp(user.id, workspace.id))
        const badKey = await app.request(
          `/workspaces/${workspace.id}/apps/${row.id}/env`,
          jsonBody('PUT', { entries: [{ key: '1BAD', value: 'x' }] }),
        )
        expect(badKey.status).toBe(400)

        const multiline = await app.request(
          `/workspaces/${workspace.id}/apps/${row.id}/env`,
          jsonBody('PUT', { entries: [{ key: 'A', value: 'x\ny' }] }),
        )
        expect(multiline.status).toBe(400)

        // A registered folder that doesn't exist on disk — actionable 400, not a 500.
        const ghost = insertApp(
          db,
          makeApp(user.id, workspace.id, { name: 'Ghost', cwdRelative: 'not/on/disk' }),
        )
        const folderMissing = await app.request(
          `/workspaces/${workspace.id}/apps/${ghost.id}/env`,
          jsonBody('PUT', { entries: [{ key: 'A', value: '1' }] }),
        )
        expect(folderMissing.status).toBe(400)
      })
    })

    it("404s on another user's app (tenant boundary)", async () => {
      await withTestDatabase(async (db) => {
        const app = createApp({ db, logger: silentLogger, appSupervisor: makeSupervisor() })
        const attacker = insertUser(db, makeUser())
        const attackerWorkspace = seedWorkspace(db, attacker.id)
        const victim = seedUserWorkspace(db)
        const victimApp = insertApp(db, makeApp(victim.userId, victim.workspaceId))

        const res = await app.request(
          `/workspaces/${attackerWorkspace.id}/apps/${victimApp.id}/env`,
        )
        expect(res.status).toBe(404)
      })
    })
  })
})
