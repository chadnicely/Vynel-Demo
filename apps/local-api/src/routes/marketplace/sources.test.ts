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

      const res = await postJson(app, '/marketplace/install', { itemId: 'invoicer@acme-tools' })
      expect(res.status).toBe(201)
      expect(await res.json()).toEqual({
        kind: 'plugin',
        pluginKey: 'invoicer@acme-tools',
        itemId: 'invoicer@acme-tools',
        version: null,
      })
      expect(delegate.install).toHaveBeenCalledWith({
        marketplaceRepo: 'https://github.com/acme/tools.git',
        marketplaceName: 'acme-tools',
        pluginName: 'invoicer',
      })
    })
  })

  it('a workspace surface never lists third-party rows (user-scope posture)', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      const app = createApp({
        db,
        logger: silentLogger,
        marketplaceInstalledPluginsReader: () => [],
        claudeMarketplacesReader: () => [ACME],
      })
      // No workspace exists — the global list is the only surface; the
      // scope-forcing itself is pinned in the leaf's mapper test. Assert
      // the row's surfacing scope here.
      const items = (await (await app.request('/marketplace/items')).json()) as Array<{
        itemId: string
        scope: string
      }>
      expect(items.find((item) => item.itemId === 'invoicer@acme-tools')?.scope).toBe('user')
    })
  })
})
