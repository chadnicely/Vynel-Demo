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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

// Hermetic plugin registry via the app's injectable reader seam (the
// `marketplacePluginDelegate` twin) — annotation never reads this
// machine's real `~/.claude/plugins`. Tests stock the array; the stub
// is passed to every createApp below.
import type { InstalledClaudePluginView } from '@vynel/providers'

const installedPluginRows: InstalledClaudePluginView[] = []
const listInstalledPluginsStub = () => [...installedPluginRows]
// A failed assertion must not leak a stocked registry into later tests.
afterEach(() => {
  installedPluginRows.length = 0
})

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
      const app = createApp({ db, logger: silentLogger, marketplaceInstalledPluginsReader: listInstalledPluginsStub })
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
        const app = createApp({ db, logger: silentLogger, marketplaceInstalledPluginsReader: listInstalledPluginsStub })
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
        const app = createApp({ db, logger: silentLogger, marketplaceInstalledPluginsReader: listInstalledPluginsStub })
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
          marketplaceInstalledPluginsReader: listInstalledPluginsStub,
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
      const app = createApp({ db, logger: silentLogger, hubSession: fakeHubSession({}), marketplaceInstalledPluginsReader: listInstalledPluginsStub })
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
        const app = createApp({ db, logger: silentLogger, marketplaceInstalledPluginsReader: listInstalledPluginsStub })
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
        const app = createApp({ db, logger: silentLogger, marketplaceInstalledPluginsReader: listInstalledPluginsStub })
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
      const delegate = {
        install: vi.fn(async () => {}),
        uninstall: vi.fn(async () => {}),
        addMarketplace: vi.fn(async () => {}),
        removeMarketplace: vi.fn(async () => {}),
        update: vi.fn(async () => {}),
      }
      const app = createApp({ db, logger: silentLogger, marketplacePluginDelegate: delegate, marketplaceInstalledPluginsReader: listInstalledPluginsStub })

      const res = await postJson(app, '/marketplace/install', {
        itemId: 'document-skills',
        acceptPluginExecution: true,
      })
      expect(res.status).toBe(201)
      expect(await res.json()).toEqual({
        kind: 'plugin',
        pluginKey: 'document-skills@anthropic-agent-skills',
        itemId: 'document-skills',
        version: '1.0.0',
      })
      expect(delegate.install).toHaveBeenCalledWith(pluginManifest, { kind: 'user' })

      installedPluginRows.push({
        key: 'document-skills@anthropic-agent-skills',
        pluginName: 'document-skills',
        marketplaceName: 'anthropic-agent-skills',
        version: '1.0.0',
        scope: 'user',
        projectPath: null,
      })
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

      const un = await postJson(app, '/marketplace/uninstall', {
        itemId: 'document-skills',
        acceptPluginExecution: true,
      })
      expect(un.status).toBe(200)
      expect(await un.json()).toEqual({
        kind: 'plugin',
        pluginKey: 'document-skills@anthropic-agent-skills',
        itemId: 'document-skills',
      })
      expect(delegate.uninstall).toHaveBeenCalledWith({
        pluginName: 'document-skills',
        marketplaceName: 'anthropic-agent-skills',
        installScope: { kind: 'user' },
      })
    })
  })

  it('updates a plugin in place via the delegate + reports the registry re-read version', async () => {
    await withTestDatabase(async (db) => {
      seedUser(db)
      syncCloudCatalog(
        db,
        [
          cloudCatalogItem({
            itemId: 'document-skills',
            kind: 'plugin',
            recommendedScope: 'user',
            latestVersion: '1.1.0',
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
      installedPluginRows.push({
        key: 'document-skills@anthropic-agent-skills',
        pluginName: 'document-skills',
        marketplaceName: 'anthropic-agent-skills',
        version: '1.0.0',
        scope: 'user',
        projectPath: null,
      })
      const delegate = {
        install: vi.fn(async () => {}),
        uninstall: vi.fn(async () => {}),
        addMarketplace: vi.fn(async () => {}),
        removeMarketplace: vi.fn(async () => {}),
        // The real delegate drives `claude plugin update`, after which the
        // registry holds whatever the publisher's marketplace ACTUALLY
        // ships — deliberately different from the catalog's 1.1.0 here, so
        // the assertion proves the response is the registry re-read and
        // not the catalog number.
        update: vi.fn(async () => {
          installedPluginRows[0]!.version = '1.1.1'
        }),
      }
      const app = createApp({ db, logger: silentLogger, marketplacePluginDelegate: delegate, marketplaceInstalledPluginsReader: listInstalledPluginsStub })

      // No dead Get buttons: the descriptor-less plugin never surfaces.
      const listRes = await app.request('/marketplace/items')
      const ids = ((await listRes.json()) as Array<{ itemId: string }>).map((i) => i.itemId)
      expect(ids).toContain('document-skills')
      expect(ids).not.toContain('broken-plugin')

      const res = await postJson(app, '/marketplace/update', {
        itemId: 'document-skills',
        acceptPluginExecution: true,
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        kind: 'plugin',
        pluginKey: 'document-skills@anthropic-agent-skills',
        itemId: 'document-skills',
        version: '1.1.1',
      })
      expect(delegate.update).toHaveBeenCalledWith({
        pluginName: 'document-skills',
        marketplaceName: 'anthropic-agent-skills',
        installScope: { kind: 'user' },
      })
    })
  })
})

describe('mcp kind — config-is-truth install/uninstall', () => {
  const playwrightManifest = {
    serverName: 'playwright',
    transport: 'stdio',
    commandOrUrl: 'npx',
    args: ['@playwright/mcp@latest'],
  }

  it('user scope end-to-end: Get writes ~/.claude.json, list flips to Installed, Remove clears it', async () => {
    await withIsolatedHome(async () => {
      await withTestDatabase(async (db) => {
        seedUser(db)
        syncCloudCatalog(
          db,
          [
            cloudCatalogItem({
              itemId: 'playwright-mcp',
              kind: 'mcp',
              recommendedScope: 'both',
              latestVersionManifestJson: JSON.stringify(playwrightManifest),
            }),
            cloudCatalogItem({
              itemId: 'broken-mcp',
              kind: 'mcp',
              recommendedScope: 'both',
              latestVersionManifestJson: '{"nope":true}',
            }),
          ],
          new Date(),
        )
        const app = createApp({
          db,
          logger: silentLogger,
          marketplaceInstalledPluginsReader: listInstalledPluginsStub,
        })

        // No dead Get buttons: the descriptor-less mcp row never surfaces.
        const ids = (
          (await (await app.request('/marketplace/items')).json()) as Array<{ itemId: string }>
        ).map((i) => i.itemId)
        expect(ids).toContain('playwright-mcp')
        expect(ids).not.toContain('broken-mcp')

        const res = await postJson(app, '/marketplace/install', { itemId: 'playwright-mcp' })
        expect(res.status).toBe(201)
        expect(await res.json()).toEqual({
          kind: 'mcp',
          serverName: 'playwright',
          itemId: 'playwright-mcp',
          scope: 'user',
          version: '1.0.0',
          authRequired: false,
        })

        const items = (await (await app.request('/marketplace/items')).json()) as Array<{
          itemId: string
          installStatus: unknown
        }>
        expect(items.find((i) => i.itemId === 'playwright-mcp')?.installStatus).toEqual({
          kind: 'installed',
          scope: 'user',
          installedId: 'playwright',
          versionInstalled: null,
        })

        const un = await postJson(app, '/marketplace/uninstall', { itemId: 'playwright-mcp' })
        expect(un.status).toBe(200)
        expect(await un.json()).toEqual({
          kind: 'mcp',
          serverName: 'playwright',
          itemId: 'playwright-mcp',
        })
        const after = (await (await app.request('/marketplace/items')).json()) as Array<{
          itemId: string
          installStatus: { kind: string }
        }>
        expect(after.find((i) => i.itemId === 'playwright-mcp')?.installStatus.kind).toBe(
          'not-installed',
        )
      })
    })
  })

  it('workspace scope: the entry lands in that workspace\'s .mcp.json', async () => {
    await withIsolatedHome(async () => {
      await withTestDatabase(async (db) => {
        const user = seedUser(db)
        const now = new Date()
        const workspaceDir = mkdtempSync(join(tmpdir(), 'vynel-marketplace-mcp-ws-'))
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
          syncCloudCatalog(
            db,
            [
              cloudCatalogItem({
                itemId: 'playwright-mcp',
                kind: 'mcp',
                recommendedScope: 'both',
                latestVersionManifestJson: JSON.stringify(playwrightManifest),
              }),
            ],
            new Date(),
          )
          const app = createApp({
            db,
            logger: silentLogger,
            marketplaceInstalledPluginsReader: listInstalledPluginsStub,
          })

          const res = await postJson(app, `/workspaces/${workspace.id}/marketplace/install`, {
            itemId: 'playwright-mcp',
            scope: 'workspace',
          })
          expect(res.status).toBe(201)
          expect(await res.json()).toMatchObject({ kind: 'mcp', scope: 'workspace' })

          const workspaceConfig = JSON.parse(
            readFileSync(join(workspaceDir, '.mcp.json'), 'utf8'),
          ) as { mcpServers: Record<string, unknown> }
          expect(Object.keys(workspaceConfig.mcpServers)).toEqual(['playwright'])

          // The workspace surface shows Installed at workspace scope; the
          // GLOBAL surface (user config only) still shows Get.
          const wsItems = (await (
            await app.request(`/workspaces/${workspace.id}/marketplace/items`)
          ).json()) as Array<{ itemId: string; installStatus: { kind: string; scope?: string } }>
          expect(wsItems.find((i) => i.itemId === 'playwright-mcp')?.installStatus).toMatchObject({
            kind: 'installed',
            scope: 'workspace',
          })
          const globalItems = (await (await app.request('/marketplace/items')).json()) as Array<{
            itemId: string
            installStatus: { kind: string }
          }>
          expect(globalItems.find((i) => i.itemId === 'playwright-mcp')?.installStatus.kind).toBe(
            'not-installed',
          )
        } finally {
          rmSync(workspaceDir, { recursive: true, force: true })
        }
      })
    })
  })

  it('dual scope: user install from the workspace surface lands in ~/.claude.json; uninstall peels workspace first (D12), then user', async () => {
    await withIsolatedHome(async () => {
      await withTestDatabase(async (db) => {
        const user = seedUser(db)
        const now = new Date()
        const workspaceDir = mkdtempSync(join(tmpdir(), 'vynel-marketplace-mcp-dual-'))
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
          syncCloudCatalog(
            db,
            [
              cloudCatalogItem({
                itemId: 'playwright-mcp',
                kind: 'mcp',
                recommendedScope: 'both',
                latestVersionManifestJson: JSON.stringify(playwrightManifest),
              }),
            ],
            new Date(),
          )
          const app = createApp({
            db,
            logger: silentLogger,
            marketplaceInstalledPluginsReader: listInstalledPluginsStub,
          })
          const base = `/workspaces/${workspace.id}/marketplace`

          // User-scope install issued FROM the workspace surface — the
          // entry lands in the HOME config, not the workspace's.
          const userRes = await postJson(app, `${base}/install`, {
            itemId: 'playwright-mcp',
            scope: 'user',
          })
          expect(userRes.status).toBe(201)
          expect(await userRes.json()).toMatchObject({ kind: 'mcp', scope: 'user' })
          expect(existsSync(join(workspaceDir, '.mcp.json'))).toBe(false)

          await postJson(app, `${base}/install`, { itemId: 'playwright-mcp', scope: 'workspace' })

          const statusOf = async () =>
            (
              (await (await app.request(`${base}/items`)).json()) as Array<{
                itemId: string
                installStatus: { kind: string; scope?: string }
              }>
            ).find((i) => i.itemId === 'playwright-mcp')?.installStatus

          expect(await statusOf()).toMatchObject({ kind: 'installed', scope: 'workspace' })

          // First Remove peels the D12-preferred workspace entry — the
          // user-scope install remains, no stranded state.
          await postJson(app, `${base}/uninstall`, { itemId: 'playwright-mcp' })
          expect(await statusOf()).toMatchObject({ kind: 'installed', scope: 'user' })

          await postJson(app, `${base}/uninstall`, { itemId: 'playwright-mcp' })
          expect(await statusOf()).toEqual({ kind: 'not-installed' })
        } finally {
          rmSync(workspaceDir, { recursive: true, force: true })
        }
      })
    })
  })

  // Declared configuration (2026-08-09): a manifest saying what the user
  // must supply — the shelf carries the declaration (mcpAuth), a value-less
  // install answers the actionable 400 (the session tool's path — secrets
  // never transit chat), and supplied values merge into the entry.
  const githubManifest = {
    serverName: 'github',
    transport: 'stdio',
    commandOrUrl: 'npx',
    args: ['github-mcp'],
    environment: { LOG_LEVEL: 'warn' },
    requiredEnvironment: [{ name: 'GITHUB_TOKEN', label: 'GitHub token' }],
  }

  it('configuration-declaring item: shelf carries mcpAuth, value-less install 400s with labels, values merge into the entry', async () => {
    await withIsolatedHome(async () => {
      await withTestDatabase(async (db) => {
        const user = seedUser(db)
        const now = new Date()
        const workspaceDir = mkdtempSync(join(tmpdir(), 'vynel-marketplace-mcp-config-'))
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
          syncCloudCatalog(
            db,
            [
              cloudCatalogItem({
                itemId: 'github-mcp',
                kind: 'mcp',
                recommendedScope: 'both',
                latestVersionManifestJson: JSON.stringify(githubManifest),
              }),
            ],
            new Date(),
          )
          const app = createApp({
            db,
            logger: silentLogger,
            marketplaceInstalledPluginsReader: listInstalledPluginsStub,
          })
          const base = `/workspaces/${workspace.id}/marketplace`

          const listed = (
            (await (await app.request(`${base}/items`)).json()) as Array<{
              itemId: string
              mcpAuth?: unknown
            }>
          ).find((i) => i.itemId === 'github-mcp')
          expect(listed?.mcpAuth).toEqual({
            kind: 'fields',
            fields: [{ name: 'GITHUB_TOKEN', label: 'GitHub token', secret: true }],
          })

          const valueless = await postJson(app, `${base}/install`, {
            itemId: 'github-mcp',
            scope: 'workspace',
          })
          expect(valueless.status).toBe(400)
          const valuelessBody = (await valueless.json()) as { message: string }
          expect(valuelessBody.message).toContain('GitHub token')
          expect(valuelessBody.message).toContain('Marketplace')
          expect(existsSync(join(workspaceDir, '.mcp.json'))).toBe(false)

          const undeclared = await postJson(app, `${base}/install`, {
            itemId: 'github-mcp',
            scope: 'workspace',
            mcpConfigurationValues: { GITHUB_TOKEN: 'tok-1', SNEAKY: 'x' },
          })
          expect(undeclared.status).toBe(400)
          expect(((await undeclared.json()) as { message: string }).message).toContain('SNEAKY')

          const res = await postJson(app, `${base}/install`, {
            itemId: 'github-mcp',
            scope: 'workspace',
            mcpConfigurationValues: { GITHUB_TOKEN: 'tok-1' },
          })
          expect(res.status).toBe(201)
          expect(await res.json()).toMatchObject({ kind: 'mcp', authRequired: false })

          const config = JSON.parse(
            readFileSync(join(workspaceDir, '.mcp.json'), 'utf8'),
          ) as { mcpServers: Record<string, { env: Record<string, string>; _vynelProvenance: { itemId: string } }> }
          expect(config.mcpServers.github!.env).toEqual({
            LOG_LEVEL: 'warn',
            GITHUB_TOKEN: 'tok-1',
          })
          expect(config.mcpServers.github!._vynelProvenance.itemId).toBe('github-mcp')
        } finally {
          rmSync(workspaceDir, { recursive: true, force: true })
        }
      })
    })
  })

  it('an oauth item installs credential-less and answers authRequired: true', async () => {
    await withIsolatedHome(async () => {
      await withTestDatabase(async (db) => {
        const user = seedUser(db)
        const now = new Date()
        const workspaceDir = mkdtempSync(join(tmpdir(), 'vynel-marketplace-mcp-oauth-'))
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
          syncCloudCatalog(
            db,
            [
              cloudCatalogItem({
                itemId: 'notion-mcp',
                kind: 'mcp',
                recommendedScope: 'both',
                latestVersionManifestJson: JSON.stringify({
                  serverName: 'notion',
                  transport: 'http',
                  url: 'https://mcp.notion.com/mcp',
                  auth: { type: 'oauth' },
                }),
              }),
            ],
            new Date(),
          )
          const app = createApp({
            db,
            logger: silentLogger,
            marketplaceInstalledPluginsReader: listInstalledPluginsStub,
          })
          const base = `/workspaces/${workspace.id}/marketplace`

          const listed = (
            (await (await app.request(`${base}/items`)).json()) as Array<{
              itemId: string
              mcpAuth?: unknown
            }>
          ).find((i) => i.itemId === 'notion-mcp')
          expect(listed?.mcpAuth).toEqual({ kind: 'oauth' })

          const res = await postJson(app, `${base}/install`, {
            itemId: 'notion-mcp',
            scope: 'workspace',
          })
          expect(res.status).toBe(201)
          expect(await res.json()).toMatchObject({ kind: 'mcp', authRequired: true })

          const config = JSON.parse(
            readFileSync(join(workspaceDir, '.mcp.json'), 'utf8'),
          ) as { mcpServers: Record<string, Record<string, unknown>> }
          expect(config.mcpServers.notion).toMatchObject({
            type: 'http',
            url: 'https://mcp.notion.com/mcp',
          })
          // Credential-less: no headers key at all until the user connects.
          expect(config.mcpServers.notion!.headers).toBeUndefined()
        } finally {
          rmSync(workspaceDir, { recursive: true, force: true })
        }
      })
    })
  })
})

describe('rule kind — config-is-truth install/uninstall', () => {
  const ruleManifest = {
    ruleMarkdown: '# Conventional Commits\n\nUse type(scope): description.',
  }

  it('user scope end-to-end: Get writes the marked ~/.claude/rules file, list flips, Remove clears', async () => {
    await withIsolatedHome(async () => {
      await withTestDatabase(async (db) => {
        seedUser(db)
        syncCloudCatalog(
          db,
          [
            cloudCatalogItem({
              itemId: 'conventional-commits',
              kind: 'rule',
              recommendedScope: 'both',
              latestVersionManifestJson: JSON.stringify(ruleManifest),
            }),
            cloudCatalogItem({
              itemId: 'broken-rule',
              kind: 'rule',
              recommendedScope: 'both',
              latestVersionManifestJson: '{"nope":true}',
            }),
          ],
          new Date(),
        )
        const app = createApp({
          db,
          logger: silentLogger,
          marketplaceInstalledPluginsReader: listInstalledPluginsStub,
        })

        // No dead Get buttons: the content-less rule row never surfaces.
        const ids = (
          (await (await app.request('/marketplace/items')).json()) as Array<{ itemId: string }>
        ).map((i) => i.itemId)
        expect(ids).toContain('conventional-commits')
        expect(ids).not.toContain('broken-rule')

        const res = await postJson(app, '/marketplace/install', { itemId: 'conventional-commits' })
        expect(res.status).toBe(201)
        expect(await res.json()).toEqual({
          kind: 'rule',
          ruleId: 'conventional-commits',
          itemId: 'conventional-commits',
          scope: 'user',
          version: '1.0.0',
        })

        const items = (await (await app.request('/marketplace/items')).json()) as Array<{
          itemId: string
          installStatus: unknown
        }>
        expect(items.find((i) => i.itemId === 'conventional-commits')?.installStatus).toEqual({
          kind: 'installed',
          scope: 'user',
          installedId: 'conventional-commits',
          versionInstalled: '1.0.0',
        })

        const un = await postJson(app, '/marketplace/uninstall', { itemId: 'conventional-commits' })
        expect(un.status).toBe(200)
        expect(await un.json()).toEqual({
          kind: 'rule',
          ruleId: 'conventional-commits',
          itemId: 'conventional-commits',
        })
      })
    })
  })

  it('update 400s for a rule item — no in-place update outside skills and plugins', async () => {
    await withIsolatedHome(async () => {
      await withTestDatabase(async (db) => {
        seedUser(db)
        syncCloudCatalog(
          db,
          [
            cloudCatalogItem({
              itemId: 'conventional-commits',
              kind: 'rule',
              recommendedScope: 'both',
              latestVersionManifestJson: JSON.stringify(ruleManifest),
            }),
          ],
          new Date(),
        )
        const app = createApp({
          db,
          logger: silentLogger,
          marketplaceInstalledPluginsReader: listInstalledPluginsStub,
        })
        await postJson(app, '/marketplace/install', { itemId: 'conventional-commits' })

        const res = await postJson(app, '/marketplace/update', { itemId: 'conventional-commits' })
        expect(res.status).toBe(400)
      })
    })
  })

  it('a hand-authored rule file never annotates, and Get refuses to overwrite it (409)', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'vynel-rule-handmade-home-'))
    try {
      await withSkillsHomeDir(homeDir, async () => {
        await withTestDatabase(async (db) => {
          seedUser(db)
          syncCloudCatalog(
            db,
            [
              cloudCatalogItem({
                itemId: 'security',
                kind: 'rule',
                recommendedScope: 'both',
                latestVersionManifestJson: JSON.stringify(ruleManifest),
              }),
            ],
            new Date(),
          )
          // A pre-existing hand-written ~/.claude/rules/security.md — no
          // provenance marker, so it is the user's own file.
          mkdirSync(join(homeDir, '.claude', 'rules'), { recursive: true })
          writeFileSync(
            join(homeDir, '.claude', 'rules', 'security.md'),
            '# My own security rules\n',
            'utf8',
          )
          const app = createApp({
            db,
            logger: silentLogger,
            marketplaceInstalledPluginsReader: listInstalledPluginsStub,
          })

          const items = (await (await app.request('/marketplace/items')).json()) as Array<{
            itemId: string
            installStatus: { kind: string }
          }>
          expect(items.find((i) => i.itemId === 'security')?.installStatus.kind).toBe(
            'not-installed',
          )

          const res = await postJson(app, '/marketplace/install', { itemId: 'security' })
          expect(res.status).toBe(409)
          expect(readFileSync(join(homeDir, '.claude', 'rules', 'security.md'), 'utf8')).toBe(
            '# My own security rules\n',
          )
        })
      })
    } finally {
      rmSync(homeDir, { recursive: true, force: true })
    }
  })
})

// Slice 3: an oauth item's uninstall clears the native credential
// best-effort BEFORE the entry goes — and a failed logout never blocks
// the uninstall the user asked for.
describe('mcp oauth uninstall — credential cleanup', () => {
  const oauthCatalog = () => [
    cloudCatalogItem({
      itemId: 'notion-mcp',
      kind: 'mcp',
      recommendedScope: 'both',
      latestVersionManifestJson: JSON.stringify({
        serverName: 'notion',
        transport: 'http',
        url: 'https://mcp.notion.com/mcp',
        auth: { type: 'oauth' },
      }),
    }),
  ]

  it('runs logout with the workspace directory, then removes the entry', async () => {
    const logoutCalls: Array<{ serverName: string; workingDirectory?: string }> = []
    await withIsolatedHome(async () => {
      await withTestDatabase(async (db) => {
        const user = seedUser(db)
        const now = new Date()
        const workspaceDir = mkdtempSync(join(tmpdir(), 'vynel-marketplace-oauth-un-'))
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
          syncCloudCatalog(db, oauthCatalog(), new Date())
          const app = createApp({
            db,
            logger: silentLogger,
            marketplaceInstalledPluginsReader: listInstalledPluginsStub,
            mcpAuthDelegate: {
              login: async () => {},
              logout: async (input) => {
                logoutCalls.push(input)
              },
            },
          })
          const base = `/workspaces/${workspace.id}/marketplace`
          await postJson(app, `${base}/install`, { itemId: 'notion-mcp', scope: 'workspace' })

          const un = await postJson(app, `${base}/uninstall`, { itemId: 'notion-mcp' })
          expect(un.status).toBe(200)
          expect(logoutCalls).toEqual([
            { serverName: 'notion', workingDirectory: workspaceDir },
          ])
          const config = JSON.parse(
            readFileSync(join(workspaceDir, '.mcp.json'), 'utf8'),
          ) as { mcpServers: Record<string, unknown> }
          expect(config.mcpServers.notion).toBeUndefined()
        } finally {
          rmSync(workspaceDir, { recursive: true, force: true })
        }
      })
    })
  })

  it('a throwing logout never blocks the uninstall', async () => {
    await withIsolatedHome(async () => {
      await withTestDatabase(async (db) => {
        const user = seedUser(db)
        const now = new Date()
        const workspaceDir = mkdtempSync(join(tmpdir(), 'vynel-marketplace-oauth-fail-'))
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
          syncCloudCatalog(db, oauthCatalog(), new Date())
          const app = createApp({
            db,
            logger: silentLogger,
            marketplaceInstalledPluginsReader: listInstalledPluginsStub,
            mcpAuthDelegate: {
              login: async () => {},
              logout: async () => {
                throw new Error('never connected')
              },
            },
          })
          const base = `/workspaces/${workspace.id}/marketplace`
          await postJson(app, `${base}/install`, { itemId: 'notion-mcp', scope: 'workspace' })

          const un = await postJson(app, `${base}/uninstall`, { itemId: 'notion-mcp' })
          expect(un.status).toBe(200)
          const config = JSON.parse(
            readFileSync(join(workspaceDir, '.mcp.json'), 'utf8'),
          ) as { mcpServers: Record<string, unknown> }
          expect(config.mcpServers.notion).toBeUndefined()
        } finally {
          rmSync(workspaceDir, { recursive: true, force: true })
        }
      })
    })
  })
})
