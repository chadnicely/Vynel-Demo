// The marketplace SOURCES surface + the third-party shelf flow, full HTTP
// stack: registration normalizes to the https .git form (the CLI's
// owner/repo shorthand needs auth state the daemon may not have), a
// registered marketplace's plugins join the GLOBAL shelf as community
// rows, and installing one drives the plugin delegate with the row's own
// facts (no hub cache involved).

import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import type { ClaudeMarketplaceSourceView } from '@vynel/marketplace'
import { createApp } from '../../app.js'

const silentLogger = pino({ level: 'silent' })

function seedUser(db: Parameters<Parameters<typeof withTestDatabase>[0]>[0]) {
  const now = new Date()
  return insertUser(db, {
    id: randomUUID(),
    displayName: 'T',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: true,
    createdAt: now,
    updatedAt: now,
  })
}

const ACME: ClaudeMarketplaceSourceView = {
  marketplaceName: 'acme-tools',
  sourceUrl: 'https://github.com/acme/tools.git',
  ownerName: 'Acme Inc',
  plugins: [
    { pluginName: 'invoicer', description: 'Invoices', version: '1.1.0', category: 'business' },
  ],
}

function fakeDelegate() {
  return {
    install: vi.fn(async () => {}),
    uninstall: vi.fn(async () => {}),
    update: vi.fn(async () => {}),
    addMarketplace: vi.fn(async () => {}),
    removeMarketplace: vi.fn(async () => {}),
  }
}

async function postJson(app: ReturnType<typeof createApp>, path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('marketplace sources routes', () => {
  it('lists registered marketplaces with plugin counts', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const app = createApp({
        db,
        logger: silentLogger,
        marketplaceInstalledPluginsReader: () => [],
        claudeMarketplacesReader: () => [ACME],
      })
      const res = await app.request('/marketplace/sources')
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        sources: [
          {
            marketplaceName: 'acme-tools',
            sourceUrl: 'https://github.com/acme/tools.git',
            ownerName: 'Acme Inc',
            pluginCount: 1,
          },
        ],
      })
    })
  })

  it('add normalizes owner/repo to the https .git URL and drives the delegate', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const delegate = fakeDelegate()
      const app = createApp({
        db,
        logger: silentLogger,
        marketplacePluginDelegate: delegate,
        marketplaceInstalledPluginsReader: () => [],
        claudeMarketplacesReader: () => [ACME],
      })
      const res = await postJson(app, '/marketplace/sources', { source: 'acme/tools' })
      expect(res.status).toBe(201)
      expect(delegate.addMarketplace).toHaveBeenCalledWith({
        sourceUrl: 'https://github.com/acme/tools.git',
      })
      expect(await res.json()).toMatchObject({ marketplaceName: 'acme-tools', pluginCount: 1 })
    })
  })

  it('add refuses non-https sources before the delegate runs', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const delegate = fakeDelegate()
      const app = createApp({
        db,
        logger: silentLogger,
        marketplacePluginDelegate: delegate,
        marketplaceInstalledPluginsReader: () => [],
        claudeMarketplacesReader: () => [],
      })
      for (const source of [
        'http://x.dev/m.git',
        'git@github.com:a/b.git',
        'C:\\local\\path',
        // Credentials would persist into Claude's registry file and the log.
        'https://user:tok-secret@github.com/a/b.git',
      ]) {
        const res = await postJson(app, '/marketplace/sources', { source })
        expect(res.status).toBe(400)
        expect(JSON.stringify(await res.json())).not.toContain('tok-secret')
      }
      expect(delegate.addMarketplace).not.toHaveBeenCalled()
    })
  })

  it('remove drives the delegate for a known name and 404s an unknown one', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const delegate = fakeDelegate()
      const app = createApp({
        db,
        logger: silentLogger,
        marketplacePluginDelegate: delegate,
        marketplaceInstalledPluginsReader: () => [],
        claudeMarketplacesReader: () => [ACME],
      })
      expect(
        (await app.request('/marketplace/sources/acme-tools', { method: 'DELETE' })).status,
      ).toBe(204)
      expect(delegate.removeMarketplace).toHaveBeenCalledWith({ marketplaceName: 'acme-tools' })
      expect(
        (await app.request('/marketplace/sources/never-heard', { method: 'DELETE' })).status,
      ).toBe(404)
    })
  })
})

describe('third-party rows on the GLOBAL shelf', () => {
  it('lists community rows keyed by pluginKey; install drives the delegate from row facts', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const delegate = fakeDelegate()
      const app = createApp({
        db,
        logger: silentLogger,
        marketplacePluginDelegate: delegate,
        marketplaceInstalledPluginsReader: () => [],
        claudeMarketplacesReader: () => [ACME],
      })

      const items = (await (await app.request('/marketplace/items')).json()) as Array<{
        itemId: string
        source: unknown
        isOfficial: boolean
        publisherTier: string
      }>
      const row = items.find((item) => item.itemId === 'invoicer@acme-tools')
      expect(row).toMatchObject({
        source: { kind: 'claude-marketplace', marketplaceName: 'acme-tools' },
        isOfficial: false,
        publisherTier: 'community',
      })

      const res = await postJson(app, '/marketplace/install', {
        itemId: 'invoicer@acme-tools',
        acceptPluginExecution: true,
      })
      expect(res.status).toBe(201)
      expect(await res.json()).toEqual({
        kind: 'plugin',
        pluginKey: 'invoicer@acme-tools',
        itemId: 'invoicer@acme-tools',
        version: null,
      })
      expect(delegate.install).toHaveBeenCalledWith(
        {
          marketplaceRepo: 'https://github.com/acme/tools.git',
          marketplaceName: 'acme-tools',
          pluginName: 'invoicer',
        },
        { kind: 'user' },
      )
    })
  })

  // test: correct expectation — Move C surfaces plugins on BOTH shelves
  // (workspace Get = project-scope install).
  it('third-party rows surface at scope both (workspace shelves list them too)', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const app = createApp({
        db,
        logger: silentLogger,
        marketplaceInstalledPluginsReader: () => [],
        claudeMarketplacesReader: () => [ACME],
      })
      const items = (await (await app.request('/marketplace/items')).json()) as Array<{
        itemId: string
        scope: string
      }>
      expect(items.find((item) => item.itemId === 'invoicer@acme-tools')?.scope).toBe('both')
    })
  })
})

// Move C: a workspace Get installs at PROJECT scope (context-cost
// confinement), annotates from the project entry, and a session-tool-shaped
// call (no acceptPluginExecution — the tool schema excludes it) 400s.
describe('workspace-scope plugin installs (Move C)', () => {
  it('installs project-scope, annotates per surface, and gates tool-shaped calls', async () => {
    await withTestDatabase(async (db) => {
      const { insertWorkspace } = await import('@vynel/db/repositories/workspaces')
      const user = seedUser(db)
      const now = new Date()
      const workspace = insertWorkspace(db, {
        id: randomUUID(),
        userId: user.id,
        name: 'Acme',
        kind: 'small-business',
        path: 'C:/ws/acme',
        isArchived: false,
        createdAt: now,
        updatedAt: now,
        lastAccessedAt: now,
      })
      const delegate = fakeDelegate()
      const installedRows: Array<{
        key: string
        pluginName: string
        marketplaceName: string
        version: string | null
        scope: 'user' | 'project'
        projectPath: string | null
      }> = []
      const app = createApp({
        db,
        logger: silentLogger,
        marketplacePluginDelegate: delegate,
        marketplaceInstalledPluginsReader: () => [...installedRows],
        claudeMarketplacesReader: () => [ACME],
      })
      const base = `/workspaces/${workspace.id}/marketplace`

      // Third-party rows now list on the workspace shelf (scope 'both').
      const items = (await (await app.request(`${base}/items`)).json()) as Array<{
        itemId: string
      }>
      expect(items.map((i) => i.itemId)).toContain('invoicer@acme-tools')

      // Tool-shaped call (no consent flag) → actionable 400, delegate idle.
      const refused = await postJson(app, `${base}/install`, {
        itemId: 'invoicer@acme-tools',
        scope: 'workspace',
      })
      expect(refused.status).toBe(400)
      expect(delegate.install).not.toHaveBeenCalled()

      // The UI's call installs at PROJECT scope with the workspace cwd.
      const res = await postJson(app, `${base}/install`, {
        itemId: 'invoicer@acme-tools',
        scope: 'workspace',
        acceptPluginExecution: true,
      })
      expect(res.status).toBe(201)
      expect(delegate.install).toHaveBeenCalledWith(
        {
          marketplaceRepo: 'https://github.com/acme/tools.git',
          marketplaceName: 'acme-tools',
          pluginName: 'invoicer',
        },
        { kind: 'project', workspacePath: 'C:/ws/acme' },
      )

      // Annotation: the project entry lights THIS workspace's shelf, not
      // the global one; uninstall resolves project scope.
      installedRows.push({
        key: 'invoicer@acme-tools',
        pluginName: 'invoicer',
        marketplaceName: 'acme-tools',
        version: '1.1.0',
        scope: 'project',
        projectPath: 'C:/ws/acme',
      })
      const wsItems = (await (await app.request(`${base}/items`)).json()) as Array<{
        itemId: string
        installStatus: { kind: string; scope?: string }
      }>
      expect(
        wsItems.find((i) => i.itemId === 'invoicer@acme-tools')?.installStatus,
      ).toMatchObject({ kind: 'installed', scope: 'workspace' })
      const globalItems = (await (await app.request('/marketplace/items')).json()) as Array<{
        itemId: string
        installStatus: { kind: string }
      }>
      expect(
        globalItems.find((i) => i.itemId === 'invoicer@acme-tools')?.installStatus.kind,
      ).toBe('not-installed')

      const un = await postJson(app, `${base}/uninstall`, { itemId: 'invoicer@acme-tools' })
      expect(un.status).toBe(200)
      expect(delegate.uninstall).toHaveBeenCalledWith({
        pluginName: 'invoicer',
        marketplaceName: 'acme-tools',
        installScope: { kind: 'project', workspacePath: 'C:/ws/acme' },
      })
    })
  })
})
