// Integration tests for BOTH `mcp-servers` twins — full HTTP stack over a
// real temp home dir (the skills host-home seam) + a real temp workspace
// dir. The matrix under guard: masked responses (header/env VALUES never on
// the wire), the collision 409 (a custom add must not clobber), the scope
// split (user twin ↔ ~/.claude.json, workspace twin ↔ .mcp.json), the
// https-only remote policy, and remove's 404-when-absent honesty.

import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  fn: (ctx: {
    db: Database
    app: ReturnType<typeof createApp>
    homeDir: string
    workspaceDir: string
    workspaceId: string
  }) => Promise<T>,
): Promise<T> {
  const homeDir = mkdtempSync(join(tmpdir(), 'vynel-mcp-routes-home-'))
  const workspaceDir = mkdtempSync(join(tmpdir(), 'vynel-mcp-routes-ws-'))
  try {
    return await withTestDatabase(async (db) => {
      const { workspace } = seedWorld(db, workspaceDir)
      const app = createApp({ db, logger: silentLogger })
      return withHomeDir(homeDir, () =>
        fn({ db, app, homeDir, workspaceDir, workspaceId: workspace.id }),
      )
    })
  } finally {
    rmSync(homeDir, { recursive: true, force: true })
    rmSync(workspaceDir, { recursive: true, force: true })
  }
}

const REMOTE_BODY = {
  serverName: 'linear',
  transport: 'http',
  url: 'https://mcp.example.com/mcp',
  headers: { Authorization: 'Bearer super-secret-token' },
}

describe('user-scoped /mcp-servers', () => {
  it('adds a remote server, masks its header values everywhere, and lists it', async () => {
    await withWorld(async ({ app, homeDir }) => {
      const addRes = await app.request('/mcp-servers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(REMOTE_BODY),
      })
      expect(addRes.status).toBe(201)
      const addedText = JSON.stringify(await addRes.json())
      expect(addedText).not.toContain('super-secret-token')
      expect(addedText).toContain('Authorization')

      const listRes = await app.request('/mcp-servers')
      expect(listRes.status).toBe(200)
      const listed = (await listRes.json()) as { servers: unknown[] }
      expect(JSON.stringify(listed)).not.toContain('super-secret-token')
      expect(listed.servers).toEqual([
        {
          serverName: 'linear',
          scope: 'user',
          transport: 'http',
          commandOrUrl: 'https://mcp.example.com/mcp',
          args: [],
          environmentKeys: [],
          headers: [{ name: 'Authorization', hasValue: true }],
        },
      ])

      // The config file DOES carry the secret — that is the accepted design.
      const config = JSON.parse(readFileSync(join(homeDir, '.claude.json'), 'utf8'))
      expect(config.mcpServers.linear).toEqual({
        type: 'http',
        url: 'https://mcp.example.com/mcp',
        headers: { Authorization: 'Bearer super-secret-token' },
      })
    })
  })

  it('masks env VALUES on stdio rows (names only)', async () => {
    await withWorld(async ({ app }) => {
      const addRes = await app.request('/mcp-servers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          serverName: 'local-tool',
          transport: 'stdio',
          command: 'node',
          args: ['tool.js'],
          environment: { API_KEY: 'env-secret-value' },
        }),
      })
      expect(addRes.status).toBe(201)

      const listRes = await app.request('/mcp-servers')
      const body = (await listRes.json()) as { servers: { environmentKeys: string[] }[] }
      expect(JSON.stringify(body)).not.toContain('env-secret-value')
      expect(body.servers[0]!.environmentKeys).toEqual(['API_KEY'])
    })
  })

  it('409s on a name collision instead of clobbering the existing entry', async () => {
    await withWorld(async ({ app, homeDir }) => {
      writeFileSync(
        join(homeDir, '.claude.json'),
        JSON.stringify({ mcpServers: { linear: { type: 'stdio', command: 'existing' } } }),
        'utf8',
      )
      const res = await app.request('/mcp-servers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(REMOTE_BODY),
      })
      expect(res.status).toBe(409)
      const config = JSON.parse(readFileSync(join(homeDir, '.claude.json'), 'utf8'))
      expect(config.mcpServers.linear).toEqual({ type: 'stdio', command: 'existing' })
    })
  })

  it('400s a plain-http remote URL (non-loopback)', async () => {
    await withWorld(async ({ app }) => {
      const res = await app.request('/mcp-servers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...REMOTE_BODY, url: 'http://mcp.example.com/mcp' }),
      })
      expect(res.status).toBe(400)
    })
  })

  it('removes an existing server; 404s an absent name', async () => {
    await withWorld(async ({ app, homeDir }) => {
      writeFileSync(
        join(homeDir, '.claude.json'),
        JSON.stringify({ mcpServers: { doomed: { type: 'stdio', command: 'x' } } }),
        'utf8',
      )
      expect((await app.request('/mcp-servers/doomed', { method: 'DELETE' })).status).toBe(204)
      const config = JSON.parse(readFileSync(join(homeDir, '.claude.json'), 'utf8'))
      expect(config.mcpServers.doomed).toBeUndefined()

      expect((await app.request('/mcp-servers/doomed', { method: 'DELETE' })).status).toBe(404)
    })
  })
})

describe('workspace-scoped /workspaces/:workspaceId/mcp-servers', () => {
  it('lists the user ∪ workspace union with scope chips, masked', async () => {
    await withWorld(async ({ app, homeDir, workspaceDir, workspaceId }) => {
      writeFileSync(
        join(homeDir, '.claude.json'),
        JSON.stringify({ mcpServers: { global: { type: 'stdio', command: 'g' } } }),
        'utf8',
      )
      writeFileSync(
        join(workspaceDir, '.mcp.json'),
        JSON.stringify({
          mcpServers: {
            roomy: { type: 'sse', url: 'https://ws.example.com', headers: { 'X-Key': 'shh' } },
          },
        }),
        'utf8',
      )

      const res = await app.request(`/workspaces/${workspaceId}/mcp-servers`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        servers: { serverName: string; scope: string; headers: unknown[] }[]
      }
      expect(JSON.stringify(body)).not.toContain('shh')
      expect(body.servers.map((s) => [s.serverName, s.scope])).toEqual([
        ['global', 'user'],
        ['roomy', 'workspace'],
      ])
      expect(body.servers[1]!.headers).toEqual([{ name: 'X-Key', hasValue: true }])
    })
  })

  it("adds into the workspace's .mcp.json — the home config stays untouched", async () => {
    await withWorld(async ({ app, homeDir, workspaceDir, workspaceId }) => {
      const res = await app.request(`/workspaces/${workspaceId}/mcp-servers`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(REMOTE_BODY),
      })
      expect(res.status).toBe(201)
      expect((await res.json()) as Record<string, unknown>).toMatchObject({ scope: 'workspace' })

      const wsConfig = JSON.parse(readFileSync(join(workspaceDir, '.mcp.json'), 'utf8'))
      expect(wsConfig.mcpServers.linear).toBeDefined()
      expect(() => readFileSync(join(homeDir, '.claude.json'), 'utf8')).toThrow()
    })
  })

  it('a workspace add collides only within the workspace scope (user name is free)', async () => {
    await withWorld(async ({ app, homeDir, workspaceId }) => {
      writeFileSync(
        join(homeDir, '.claude.json'),
        JSON.stringify({ mcpServers: { linear: { type: 'stdio', command: 'x' } } }),
        'utf8',
      )
      const res = await app.request(`/workspaces/${workspaceId}/mcp-servers`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(REMOTE_BODY),
      })
      expect(res.status).toBe(201)
    })
  })

  it('removes only from the workspace config; 404s an absent name', async () => {
    await withWorld(async ({ app, workspaceDir, workspaceId }) => {
      writeFileSync(
        join(workspaceDir, '.mcp.json'),
        JSON.stringify({ mcpServers: { roomy: { type: 'http', url: 'https://x.example.com' } } }),
        'utf8',
      )
      expect(
        (await app.request(`/workspaces/${workspaceId}/mcp-servers/roomy`, { method: 'DELETE' }))
          .status,
      ).toBe(204)
      expect(
        (await app.request(`/workspaces/${workspaceId}/mcp-servers/roomy`, { method: 'DELETE' }))
          .status,
      ).toBe(404)
    })
  })

  it('404s an unknown workspace', async () => {
    await withWorld(async ({ app }) => {
      const res = await app.request(`/workspaces/${randomUUID()}/mcp-servers`)
      expect(res.status).toBe(404)
    })
  })
})
