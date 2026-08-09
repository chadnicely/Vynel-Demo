// Integration tests for BOTH `mcp-servers` twins — full HTTP stack over a
// real temp home dir (the skills host-home seam) + a real temp workspace
// dir. The matrix under guard: masked responses (header/env VALUES never on
// the wire), the collision 409 (a custom add must not clobber), the scope
// split (user twin ↔ ~/.claude.json, workspace twin ↔ .mcp.json), the
// https-only remote policy, and remove's 404-when-absent honesty.

import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { describe, expect, it } from 'vitest'
import { ValidationError } from '@vynel/errors'
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
  appOptions: Partial<Parameters<typeof createApp>[0]> = {},
): Promise<T> {
  const homeDir = mkdtempSync(join(tmpdir(), 'vynel-mcp-routes-home-'))
  const workspaceDir = mkdtempSync(join(tmpdir(), 'vynel-mcp-routes-ws-'))
  try {
    return await withTestDatabase(async (db) => {
      const { workspace } = seedWorld(db, workspaceDir)
      const app = createApp({ db, logger: silentLogger, ...appOptions })
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
  // SPEC CHANGE (2026-08-03): every verb here speaks for the workspace's own
  // `.mcp.json`, so the read now agrees with the writes beside it. Listing user
  // rows was what let a click in one room delete a server from every room.
  it('lists only the workspace’s own servers, masked', async () => {
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
        ['roomy', 'workspace'],
      ])
      expect(body.servers[0]!.headers).toEqual([{ name: 'X-Key', hasValue: true }])
    })
  })

  // test: correct expectation — a workspace add now records the project
  // approval in ~/.claude.json (the consent-backed write; without it the
  // server stays untrusted to Claude Code, smoked 2026-08-09). The home
  // config's SERVER map stays untouched — was "the whole file untouched".
  it("adds into the workspace's .mcp.json — the home config stays untouched; the workspace settings gain the approval", async () => {
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
      // The HOME config stays untouched — the approval lives in the
      // workspace's own settings.local.json (the file the CLI reads).
      expect(existsSync(join(homeDir, '.claude.json'))).toBe(false)
      const settings = JSON.parse(
        readFileSync(join(workspaceDir, '.claude', 'settings.local.json'), 'utf8'),
      ) as { enabledMcpjsonServers: string[] }
      expect(settings.enabledMcpjsonServers).toEqual(['linear'])
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

// The login route (Slice 3): a remote server signs in through the injected
// auth delegate (the real one drives `claude mcp login` and opens a
// browser — tests must never reach it); stdio servers have nothing to sign
// in to; the workspace variant runs the CLI inside the workspace so its
// `.mcp.json` resolves.
describe('POST /:serverName/login', () => {
  function loginDelegate() {
    const calls: Array<{ serverName: string; workingDirectory?: string }> = []
    return {
      calls,
      delegate: {
        login: async (input: { serverName: string; workingDirectory?: string }) => {
          calls.push(input)
        },
        logout: async () => {},
      },
    }
  }

  it('signs in a user-scope remote server through the delegate', async () => {
    const { calls, delegate } = loginDelegate()
    await withWorld(
      async ({ app, homeDir }) => {
        writeFileSync(
          join(homeDir, '.claude.json'),
          JSON.stringify({
            mcpServers: { linear: { type: 'http', url: 'https://mcp.example.com/mcp' } },
          }),
          'utf8',
        )
        const res = await app.request('/mcp-servers/linear/login', { method: 'POST' })
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ connected: true })
        expect(calls).toEqual([{ serverName: 'linear' }])
      },
      { mcpAuthDelegate: delegate },
    )
  })

  it('runs the workspace login inside the workspace directory', async () => {
    const { calls, delegate } = loginDelegate()
    await withWorld(
      async ({ app, workspaceDir, workspaceId }) => {
        writeFileSync(
          join(workspaceDir, '.mcp.json'),
          JSON.stringify({
            mcpServers: { notion: { type: 'http', url: 'https://mcp.notion.com/mcp' } },
          }),
          'utf8',
        )
        const res = await app.request(
          `/workspaces/${workspaceId}/mcp-servers/notion/login`,
          { method: 'POST' },
        )
        expect(res.status).toBe(200)
        expect(calls).toEqual([{ serverName: 'notion', workingDirectory: workspaceDir }])
      },
      { mcpAuthDelegate: delegate },
    )
  })

  it('400s a stdio server and 404s an absent name — the delegate never runs', async () => {
    const { calls, delegate } = loginDelegate()
    await withWorld(
      async ({ app, homeDir }) => {
        writeFileSync(
          join(homeDir, '.claude.json'),
          JSON.stringify({
            mcpServers: { playwright: { type: 'stdio', command: 'npx', args: [], env: {} } },
          }),
          'utf8',
        )
        expect(
          (await app.request('/mcp-servers/playwright/login', { method: 'POST' })).status,
        ).toBe(400)
        expect(
          (await app.request('/mcp-servers/absent/login', { method: 'POST' })).status,
        ).toBe(404)
        expect(calls).toEqual([])
      },
      { mcpAuthDelegate: delegate },
    )
  })

  it('a delegate failure surfaces as the typed 400, not a crash', async () => {
    await withWorld(
      async ({ app, homeDir }) => {
        writeFileSync(
          join(homeDir, '.claude.json'),
          JSON.stringify({
            mcpServers: { linear: { type: 'http', url: 'https://mcp.example.com/mcp' } },
          }),
          'utf8',
        )
        const res = await app.request('/mcp-servers/linear/login', { method: 'POST' })
        expect(res.status).toBe(400)
        const body = (await res.json()) as { message: string }
        expect(body.message).toContain('browser')
      },
      {
        mcpAuthDelegate: {
          login: async () => {
            throw new ValidationError(
              "Connecting 'linear' timed out — finish the sign-in in your browser and try again.",
            )
          },
          logout: async () => {},
        },
      },
    )
  })
})

// Pre-fix workspace installs (provenance-marked entries) heal their
// missing project approval AT LOGIN — the marker is proof of the past
// carded consent. Hand-added entries never get auto-approval; that
// consent belongs to Claude Code's own review flow.
describe('workspace login heals the project approval for marked entries', () => {
  const delegateStub = { login: async () => {}, logout: async () => {} }

  it('marked entry: approval lands before the delegate runs', async () => {
    await withWorld(
      async ({ app, homeDir, workspaceDir, workspaceId }) => {
        writeFileSync(
          join(workspaceDir, '.mcp.json'),
          JSON.stringify({
            mcpServers: {
              notion: {
                type: 'http',
                url: 'https://mcp.notion.com/mcp',
                _vynelProvenance: { itemId: 'notion-mcp', installedAt: '2026-08-09T00:00:00Z' },
              },
            },
          }),
          'utf8',
        )
        const res = await app.request(
          `/workspaces/${workspaceId}/mcp-servers/notion/login`,
          { method: 'POST' },
        )
        expect(res.status).toBe(200)
        const settings = JSON.parse(
          readFileSync(join(workspaceDir, '.claude', 'settings.local.json'), 'utf8'),
        ) as { enabledMcpjsonServers: string[] }
        expect(settings.enabledMcpjsonServers).toEqual(['notion'])
      },
      { mcpAuthDelegate: delegateStub },
    )
  })

  it('hand-added (unmarked) entry: no auto-approval', async () => {
    await withWorld(
      async ({ app, homeDir, workspaceDir, workspaceId }) => {
        writeFileSync(
          join(workspaceDir, '.mcp.json'),
          JSON.stringify({
            mcpServers: { linear: { type: 'http', url: 'https://mcp.example.com/mcp' } },
          }),
          'utf8',
        )
        const res = await app.request(
          `/workspaces/${workspaceId}/mcp-servers/linear/login`,
          { method: 'POST' },
        )
        expect(res.status).toBe(200)
        // No heal for unmarked entries — no settings file appears.
        expect(existsSync(join(workspaceDir, '.claude', 'settings.local.json'))).toBe(false)
      },
      { mcpAuthDelegate: delegateStub },
    )
  })
})
