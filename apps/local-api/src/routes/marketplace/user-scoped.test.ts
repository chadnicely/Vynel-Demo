// Integration tests for the USER-scoped `/marketplace/...` routes — the
// GLOBAL marketplace surface. Full HTTP stack over the product SQLite +
// real disk (home dir isolated via BOTH packages' `withHomeDir` seams —
// a user-scope skill install writes under `~/.claude/skills/`, a
// user-scope agent install mirrors under `~/.claude/agents/`; the seams
// are per-domain module state, so each must be wrapped).
//
// The matrix under guard (Chad's rule): the global surface lists user+both
// items only, annotates against USER-scoped installs, and installs/
// uninstalls at user scope (skill rows land with `workspaceId: null`;
// agent rows with scope 'user').

import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import pino from 'pino'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { findAgentBySlug } from '@vynel/db/repositories/agents'
import { listInstalledSkillsForUserAndWorkspace } from '@vynel/skills'
import { syncCloudCatalog } from '@vynel/marketplace'
import { withHomeDir as withSkillsHomeDir } from '@vynel/skills/test-support'
import { withHomeDir as withAgentsHomeDir } from '@vynel/agents/test-support'
import type { HubSession } from '@vynel/hub-account'
import type { HubCatalogItem } from '@vynel/contracts/hub/catalog'
import { createApp } from '../../app.js'

// Hermetic plugin registry: the marketplace deps bind the provider's
// `listInstalledClaudePlugins`, which reads the developer's REAL
// `~/.claude/plugins` — mock it so annotation never depends on this
// machine (default: nothing installed).
const { listInstalledPluginsMock } = vi.hoisted(() => ({
  listInstalledPluginsMock: vi.fn(
    (): Array<{
      key: string
      pluginName: string
      marketplaceName: string
      version: string | null
    }> => [],
  ),
}))
vi.mock('@vynel/providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vynel/providers')>()
  return { ...actual, listInstalledClaudePlugins: listInstalledPluginsMock }
})
// A failed assertion must not leak a stocked registry into later tests.
afterEach(() => listInstalledPluginsMock.mockReturnValue([]))

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

function fakeHubSession(over: Partial<HubSession>): HubSession {
  return {
    getStatus: vi.fn().mockReturnValue({ kind: 'signed-in' }),
    getEntitlement: vi.fn().mockReturnValue(null),
    signIn: vi.fn(),
    signOut: vi.fn(),
    restore: vi.fn(),
    listDevices: vi.fn(),
    revokeDevice: vi.fn(),
    fetchCatalog: vi.fn(),
    downloadArtifact: vi.fn(),
    ...over,
  }
}

function cloudCatalogItem(over: Partial<HubCatalogItem> & { itemId: string }): HubCatalogItem {
  return {
    kind: 'skill',
    publisherName: 'Vynel Team',
    publisherTier: 'verified',
    publisherUrl: null,
    sourceUrl: null,
    displayName: over.itemId,
    oneLineDescription: 'x',
    category: 'email',
    iconName: 'mail',
    recommendedScope: 'both',
    minimumTier: 'basic',
    latestVersion: '1.0.0',
    latestVersionManifestJson: '{"entry":"SKILL.md"}',
    latestVersionSha256: 'a'.repeat(64),
    releasedAt: '2026-07-10T00:00:00.000Z',
    canInstall: true,
    ...over,
  }
}

async function withIsolatedHome<T>(fn: () => Promise<T>): Promise<T> {
  const homeDir = mkdtempSync(join(tmpdir(), 'vynel-marketplace-user-home-'))
  try {
    return await withSkillsHomeDir(homeDir, () => withAgentsHomeDir(homeDir, fn))
  } finally {
    rmSync(homeDir, { recursive: true, force: true })
  }
}

async function postJson(app: ReturnType<typeof createApp>, path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('GET /marketplace/items (global surface)', () => {
  it('lists user+both items and hides workspace-only ones', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      syncCloudCatalog(
        db,
        [
          cloudCatalogItem({ itemId: 'user-only', recommendedScope: 'user' }),
          cloudCatalogItem({ itemId: 'workspace-only', recommendedScope: 'workspace' }),
          cloudCatalogItem({ itemId: 'everywhere', recommendedScope: 'both' }),
        ],
        new Date(),
      )
      const app = createApp({ db, logger: silentLogger })
      const res = await app.request('/marketplace/items')
      expect(res.status).toBe(200)
      const ids = ((await res.json()) as Array<{ itemId: string }>).map((i) => i.itemId)
      expect(ids).toContain('user-only')
      expect(ids).toContain('everywhere')
      // The bundled email-drafter is scoped 'both' — on the global shelf.
      expect(ids).toContain('email-drafter')
      expect(ids).not.toContain('workspace-only')
    })
  })

  it('annotates against USER-scoped installs only (a workspace install stays "Get" here)', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const now = new Date()
      const workspaceDir = mkdtempSync(join(tmpdir(), 'vynel-marketplace-user-ws-'))
      try {
        const workspace = insertWorkspace(db, {
          id: randomUUID(),
          userId: user.id,
          name: 'Acme',
          kind: 'small-business',
          path: workspaceDir,
          isArchived: false,
          createdAt: now,
          updatedAt: now,
          lastAccessedAt: now,
        })
        const app = createApp({ db, logger: silentLogger })
        const installRes = await postJson(app, `/workspaces/${workspace.id}/marketplace/install`, {
          itemId: 'email-drafter',
          scope: 'workspace',
        })
        expect(installRes.status).toBe(201)

        const globalItems = (await (await app.request('/marketplace/items')).json()) as Array<{
          itemId: string
          installStatus: { kind: string }
        }>
        const drafter = globalItems.find((i) => i.itemId === 'email-drafter')
        expect(drafter?.installStatus.kind).toBe('not-installed')

        const workspaceItems = (await (
          await app.request(`/workspaces/${workspace.id}/marketplace/items`)
        ).json()) as Array<{ itemId: string; installStatus: { kind: string } }>
        expect(
          workspaceItems.find((i) => i.itemId === 'email-drafter')?.installStatus.kind,
        ).toBe('installed')
      } finally {
        rmSync(workspaceDir, { recursive: true, force: true })
      }
    })
  })
})

describe('POST /marketplace/install (user scope)', () => {
  it('installs a bundled skill at USER scope — the row lands with workspaceId null', async () => {
    await withIsolatedHome(async () => {
      await withTestDatabase(async (db) => {
        const user = seedUser(db)
        const app = createApp({ db, logger: silentLogger })
        const res = await postJson(app, '/marketplace/install', { itemId: 'email-drafter' })
        expect(res.status).toBe(201)
        expect(await res.json()).toMatchObject({
          kind: 'skill',
          itemId: 'email-drafter',
          scope: 'user',
          source: 'verified-catalog',
        })
        // workspaceId null = user-scope rows only (the new reader convention).
        const rows = listInstalledSkillsForUserAndWorkspace(db, {
          userId: user.id,
          workspaceId: null,
        })
        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({
          skillId: 'email-drafter',
          scope: 'user',
          workspaceId: null,
        })
      })
    })
  })

  it('installs a cloud AGENT at USER scope (agents row scope user, workspaceId null)', async () => {
    await withIsolatedHome(async () => {
      await withTestDatabase(async (db) => {
        const user = seedUser(db)
        const zip = new JSZip()
        zip.file(
          'agent.json',
          JSON.stringify({
            slug: 'focus-writer',
            name: 'Focus Writer',
            description: 'Turns rough notes into polished prose.',
            prompt: 'You are a focused writing assistant.',
          }),
        )
        const bytes = await zip.generateAsync({ type: 'nodebuffer' })
        const sha = createHash('sha256').update(bytes).digest('hex')
        syncCloudCatalog(
          db,
          [cloudCatalogItem({ itemId: 'focus-writer', kind: 'agent', latestVersionSha256: sha })],
          new Date(),
        )
        const downloadArtifact = vi.fn().mockResolvedValue(bytes)
        const app = createApp({
          db,
          logger: silentLogger,
          hubSession: fakeHubSession({ downloadArtifact }),
        })

        const res = await postJson(app, '/marketplace/install', { itemId: 'focus-writer' })
        expect(res.status).toBe(201)
        expect(await res.json()).toMatchObject({
          kind: 'agent',
          slug: 'focus-writer',
          scope: 'user',
        })
        const agent = findAgentBySlug(db, {
          userId: user.id,
          workspaceId: null,
          slug: 'focus-writer',
        })
        expect(agent).toMatchObject({ scope: 'user', workspaceId: null, source: 'community' })
      })
    })
  })

  it('404s a workspace-only item — not surfaced on the global marketplace', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      syncCloudCatalog(
        db,
        [cloudCatalogItem({ itemId: 'workspace-only', recommendedScope: 'workspace' })],
        new Date(),
      )
      const app = createApp({ db, logger: silentLogger, hubSession: fakeHubSession({}) })
      const res = await postJson(app, '/marketplace/install', { itemId: 'workspace-only' })
      expect(res.status).toBe(404)
      expect(((await res.json()) as { code: string }).code).toBe('not_found')
    })
  })
})

describe('POST /marketplace/uninstall (user scope)', () => {
  it('removes the user-scoped row and flips the global card back to Get', async () => {
    await withIsolatedHome(async () => {
      await withTestDatabase(async (db) => {
        const user = seedUser(db)
        const app = createApp({ db, logger: silentLogger })
        expect(
          (await postJson(app, '/marketplace/install', { itemId: 'email-drafter' })).status,
        ).toBe(201)

        const res = await postJson(app, '/marketplace/uninstall', { itemId: 'email-drafter' })
        expect(res.status).toBe(200)
        expect(await res.json()).toMatchObject({ kind: 'skill', itemId: 'email-drafter' })
        expect(
          listInstalledSkillsForUserAndWorkspace(db, { userId: user.id, workspaceId: null }),
        ).toHaveLength(0)
      })
    })
  })

  it('404s when the item is installed at WORKSPACE scope only (untouchable from here)', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const now = new Date()
      const workspaceDir = mkdtempSync(join(tmpdir(), 'vynel-marketplace-user-ws2-'))
      try {
        const workspace = insertWorkspace(db, {
          id: randomUUID(),
          userId: user.id,
          name: 'Acme',
          kind: 'small-business',
          path: workspaceDir,
          isArchived: false,
          createdAt: now,
          updatedAt: now,
          lastAccessedAt: now,
        })
        const app = createApp({ db, logger: silentLogger })
        expect(
          (
            await postJson(app, `/workspaces/${workspace.id}/marketplace/install`, {
              itemId: 'email-drafter',
              scope: 'workspace',
            })
          ).status,
        ).toBe(201)

        const res = await postJson(app, '/marketplace/uninstall', { itemId: 'email-drafter' })
        expect(res.status).toBe(404)
        // The workspace row survives.
        const workspaceRows = listInstalledSkillsForUserAndWorkspace(db, {
          userId: user.id,
          workspaceId: workspace.id,
        })
        expect(workspaceRows.map((r) => r.skillId)).toContain('email-drafter')
      } finally {
        rmSync(workspaceDir, { recursive: true, force: true })
      }
    })
  })
})

describe('plugin items (global surface) — the Claude-CLI delegate', () => {
  const pluginManifest = {
    marketplaceRepo: 'anthropics/skills',
    marketplaceName: 'anthropic-agent-skills',
    pluginName: 'document-skills',
  }

  it('installs via the delegate, annotates from the registry, uninstalls via the delegate', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      syncCloudCatalog(
        db,
        [
          cloudCatalogItem({
            itemId: 'document-skills',
            kind: 'plugin',
            recommendedScope: 'user',
            latestVersionManifestJson: JSON.stringify(pluginManifest),
          }),
        ],
        new Date(),
      )
      const delegate = { install: vi.fn(async () => {}), uninstall: vi.fn(async () => {}) }
      const app = createApp({ db, logger: silentLogger, marketplacePluginDelegate: delegate })

      const res = await postJson(app, '/marketplace/install', { itemId: 'document-skills' })
      expect(res.status).toBe(201)
      expect(await res.json()).toEqual({
        kind: 'plugin',
        pluginKey: 'document-skills@anthropic-agent-skills',
        itemId: 'document-skills',
        version: '1.0.0',
      })
      expect(delegate.install).toHaveBeenCalledWith(pluginManifest)

      listInstalledPluginsMock.mockReturnValue([
        {
          key: 'document-skills@anthropic-agent-skills',
          pluginName: 'document-skills',
          marketplaceName: 'anthropic-agent-skills',
          version: '1.0.0',
        },
      ])
      const listRes = await app.request('/marketplace/items')
      const items = (await listRes.json()) as Array<{
        itemId: string
        kind: string
        pluginKey?: string
        installStatus: unknown
      }>
      const item = items.find((i) => i.itemId === 'document-skills')
      expect(item?.kind).toBe('plugin')
      expect(item?.pluginKey).toBe('document-skills@anthropic-agent-skills')
      expect(item?.installStatus).toEqual({
        kind: 'installed',
        scope: 'user',
        installedId: 'document-skills@anthropic-agent-skills',
        versionInstalled: '1.0.0',
      })

      const un = await postJson(app, '/marketplace/uninstall', { itemId: 'document-skills' })
      expect(un.status).toBe(200)
      expect(await un.json()).toEqual({
        kind: 'plugin',
        pluginKey: 'document-skills@anthropic-agent-skills',
        itemId: 'document-skills',
      })
      expect(delegate.uninstall).toHaveBeenCalledWith({
        pluginName: 'document-skills',
        marketplaceName: 'anthropic-agent-skills',
      })
      listInstalledPluginsMock.mockReturnValue([])
    })
  })

  it('rejects update for a plugin item and drops one with an unparsable manifest', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      syncCloudCatalog(
        db,
        [
          cloudCatalogItem({
            itemId: 'document-skills',
            kind: 'plugin',
            recommendedScope: 'user',
            latestVersionManifestJson: JSON.stringify(pluginManifest),
          }),
          cloudCatalogItem({
            itemId: 'broken-plugin',
            kind: 'plugin',
            recommendedScope: 'user',
            latestVersionManifestJson: '{"nope":true}',
          }),
        ],
        new Date(),
      )
      listInstalledPluginsMock.mockReturnValue([
        {
          key: 'document-skills@anthropic-agent-skills',
          pluginName: 'document-skills',
          marketplaceName: 'anthropic-agent-skills',
          version: '1.0.0',
        },
      ])
      const delegate = { install: vi.fn(async () => {}), uninstall: vi.fn(async () => {}) }
      const app = createApp({ db, logger: silentLogger, marketplacePluginDelegate: delegate })

      // No dead Get buttons: the descriptor-less plugin never surfaces.
      const listRes = await app.request('/marketplace/items')
      const ids = ((await listRes.json()) as Array<{ itemId: string }>).map((i) => i.itemId)
      expect(ids).toContain('document-skills')
      expect(ids).not.toContain('broken-plugin')

      const res = await postJson(app, '/marketplace/update', { itemId: 'document-skills' })
      expect(res.status).toBe(400)
      listInstalledPluginsMock.mockReturnValue([])
    })
  })
})
