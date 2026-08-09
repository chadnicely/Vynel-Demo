// The surfacing matrix (Chad's rule): global = user+both, workspace =
// workspace+both. Covered twice — the pure helper directly, and the full
// browse pipeline over the real product SQLite (cloud rows carry their
// scope as the cache row's `recommendedScope` text; null/unknown maps to
// 'both' so legacy hub items never vanish from either surface).

import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { NotFoundError } from '@vynel/errors'
import type { HubCatalogItem } from '@vynel/contracts/hub/catalog'
import type { MarketplaceItem } from '@vynel/contracts/marketplace/marketplace-item'
import { isItemVisibleOnSurface } from './surface-visibility.js'
import { syncCloudCatalog } from './sync-cloud-catalog.js'
import { listMarketplaceItems } from './list-marketplace-items.js'
import { getMarketplaceItem } from './get-marketplace-item.js'
import type { MarketplaceDeps } from './marketplace-types.js'

const emptyDeps: MarketplaceDeps = {
  listInstalledSkills: () => [],
  listInstalledAgents: () => [],
  listInstalledPlugins: () => [],
  listInstalledMcpServers: () => [],
  listInstalledRules: () => [],
  listClaudeMarketplaces: () => [],
}

function makeItem(scope: MarketplaceItem['scope']): MarketplaceItem {
  return {
    itemId: 'x',
    kind: 'skill',
    source: { kind: 'vynel-catalog' },
    skillId: 'x',
    publisherTier: 'verified',
    publisherName: 'Vynel Team',
    publisherUrl: null,
    sourceUrl: null,
    displayName: 'X',
    oneLineDescription: 'x',
    category: 'email',
    iconName: 'mail',
    version: '1.0.0',
    releasedAt: '2026-01-01T00:00:00Z',
    recommendedScope: 'user',
    scope,
    isOfficial: true,
    hasCloudArtifact: false,
    installStatus: { kind: 'not-installed' },
  }
}

function cloudItem(
  itemId: string,
  recommendedScope: string | null,
  over: Partial<HubCatalogItem> = {},
): HubCatalogItem {
  return {
    itemId,
    kind: 'skill',
    publisherName: 'Vynel Team',
    publisherTier: 'verified',
    publisherUrl: null,
    sourceUrl: null,
    displayName: itemId,
    oneLineDescription: 'x',
    category: 'email',
    iconName: 'mail',
    recommendedScope,
    minimumTier: 'basic',
    latestVersion: '1.0.0',
    latestVersionManifestJson: '{"entry":"SKILL.md"}',
    latestVersionSha256: 'a'.repeat(64),
    releasedAt: '2026-07-10T00:00:00.000Z',
    canInstall: true,
    ...over,
  }
}

describe('isItemVisibleOnSurface', () => {
  it.each([
    ['user', 'global', true],
    ['user', 'workspace', false],
    ['workspace', 'global', false],
    ['workspace', 'workspace', true],
    ['both', 'global', true],
    ['both', 'workspace', true],
  ] as const)('scope %s on the %s surface → %s', (scope, surface, visible) => {
    expect(isItemVisibleOnSurface(makeItem(scope), surface)).toBe(visible)
  })
})

describe('surface filtering through the browse pipeline', () => {
  it('global lists user+both (incl. legacy null-scope rows); workspace lists workspace+both', async () => {
    await withTestDatabase(async (db) => {
      syncCloudCatalog(
        db,
        [
          cloudItem('user-only', 'user'),
          cloudItem('workspace-only', 'workspace'),
          cloudItem('everywhere', 'both'),
          // A legacy hub row published before the scope rollout.
          cloudItem('legacy-null', null),
        ],
        new Date(),
      )

      const globalIds = listMarketplaceItems(
        db,
        { userId: 'u', surface: 'global' },
        emptyDeps,
      ).map((i) => i.itemId)
      expect(globalIds).toContain('user-only')
      expect(globalIds).toContain('everywhere')
      expect(globalIds).toContain('legacy-null')
      expect(globalIds).not.toContain('workspace-only')
      // The bundled email-drafter is 'both' — on the global shelf too.
      expect(globalIds).toContain('email-drafter')

      const workspaceIds = listMarketplaceItems(
        db,
        { userId: 'u', surface: 'workspace', workspaceId: 'w' },
        emptyDeps,
      ).map((i) => i.itemId)
      expect(workspaceIds).toContain('workspace-only')
      expect(workspaceIds).toContain('everywhere')
      expect(workspaceIds).toContain('legacy-null')
      expect(workspaceIds).not.toContain('user-only')
      expect(workspaceIds).toContain('email-drafter')
    })
  })

  it('getMarketplaceItem 404s an off-surface id exactly like an unknown id', async () => {
    await withTestDatabase(async (db) => {
      syncCloudCatalog(db, [cloudItem('workspace-only', 'workspace')], new Date())
      expect(() =>
        getMarketplaceItem(
          db,
          { itemId: 'workspace-only', userId: 'u', surface: 'global' },
          emptyDeps,
        ),
      ).toThrow(NotFoundError)
      // Same entity + message shape as a truly unknown id — no
      // enumeration distinguisher.
      const offSurface = catchError(() =>
        getMarketplaceItem(
          db,
          { itemId: 'workspace-only', userId: 'u', surface: 'global' },
          emptyDeps,
        ),
      )
      const unknown = catchError(() =>
        getMarketplaceItem(db, { itemId: 'no-such-item', userId: 'u', surface: 'global' }, emptyDeps),
      )
      expect(offSurface).toBeInstanceOf(NotFoundError)
      expect(unknown).toBeInstanceOf(NotFoundError)
      expect((offSurface as NotFoundError).message.replace('workspace-only', 'no-such-item')).toBe(
        (unknown as NotFoundError).message,
      )
    })
  })

  it('annotates the GLOBAL surface against USER-scoped installs only', async () => {
    await withTestDatabase(async (db) => {
      syncCloudCatalog(db, [cloudItem('everywhere', 'both')], new Date())
      // Reader honoring the null-workspace convention: user-scope rows only.
      const deps: MarketplaceDeps = {
        listInstalledSkills: (_db, owner) =>
          owner.workspaceId === null
            ? []
            : [
                {
                  id: 'w-row',
                  skillId: 'everywhere',
                  workspaceId: owner.workspaceId,
                  scope: 'workspace',
                  versionInstalled: '1.0.0',
                },
              ],
        listInstalledAgents: () => [],
        listInstalledPlugins: () => [],
        listInstalledMcpServers: () => [],
        listInstalledRules: () => [],
        listClaudeMarketplaces: () => [],
      }
      // Installed only at WORKSPACE scope → the global shelf still says Get.
      const globalItem = listMarketplaceItems(db, { userId: 'u', surface: 'global' }, deps).find(
        (i) => i.itemId === 'everywhere',
      )
      expect(globalItem?.installStatus.kind).toBe('not-installed')
      // The workspace shelf shows it installed (D12 behavior unchanged).
      const workspaceItem = listMarketplaceItems(
        db,
        { userId: 'u', surface: 'workspace', workspaceId: 'w' },
        deps,
      ).find((i) => i.itemId === 'everywhere')
      expect(workspaceItem?.installStatus.kind).toBe('installed')
    })
  })
})

function catchError(fn: () => unknown): unknown {
  try {
    fn()
    return null
  } catch (error) {
    return error
  }
}
