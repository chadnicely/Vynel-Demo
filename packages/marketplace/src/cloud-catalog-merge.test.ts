// The cloud/bundled merge over the real product SQLite. The headline case is
// the COLLISION: `email-drafter` ships in the bundled VERIFIED_SKILL_CATALOG
// AND was seeded to the cloud — the merge must dedup it (cloud-wins) so the
// install-status annotation (keyed on skillId) can't double-count.

import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import type { HubCatalogItem } from '@vynel/contracts/hub/catalog'
import { syncCloudCatalog, clearCachedCloudCatalog } from './sync-cloud-catalog.js'
import { resolveMergedCatalog } from './resolve-merged-catalog.js'
import { listMarketplaceItems } from './list-marketplace-items.js'

function cloudItem(over: Partial<HubCatalogItem> & { itemId: string }): HubCatalogItem {
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
    // 'both' — these tests browse the WORKSPACE surface; the surfacing
    // matrix itself is covered in surface-visibility.test.ts.
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

describe('cloud catalog merge', () => {
  it('dedups the bundled+cloud collision (cloud-wins), keeps agents, filters mcp/rule', async () => {
    await withTestDatabase(async (db) => {
      syncCloudCatalog(
        db,
        [
          cloudItem({ itemId: 'email-drafter', displayName: 'Email Drafter (Cloud)' }),
          cloudItem({ itemId: 'pro-skill', displayName: 'Pro Skill', minimumTier: 'pro' }),
          cloudItem({ itemId: 'focus-writer', kind: 'agent', displayName: 'Focus Writer' }),
          cloudItem({ itemId: 'some-mcp', kind: 'mcp' }),
          cloudItem({ itemId: 'some-rule', kind: 'rule' }),
        ],
        new Date(),
      )

      const merged = resolveMergedCatalog(db)
      const drafter = merged.filter((i) => i.itemId === 'email-drafter')
      expect(drafter).toHaveLength(1)
      // Cloud won the collision.
      expect(drafter[0]?.displayName).toBe('Email Drafter (Cloud)')
      // Cloud-only skill carries its tier for the Pro badge.
      expect(merged.find((i) => i.itemId === 'pro-skill')?.minimumTier).toBe('pro')
      // Agent items are installable now (C-agents) and carry their kind.
      expect(merged.find((i) => i.itemId === 'focus-writer')?.kind).toBe('agent')
      // Bundled rows stamp 'skill'.
      expect(merged.every((i) => i.kind === 'skill' || i.kind === 'agent')).toBe(true)
      // Non-installable kinds stay hidden — honest UI over dead Get buttons.
      expect(merged.map((i) => i.itemId)).not.toContain('some-mcp')
      expect(merged.map((i) => i.itemId)).not.toContain('some-rule')
    })
  })

  it('surfaces a plugin row with its registry key; drops one without a parsable descriptor', async () => {
    await withTestDatabase(async (db) => {
      syncCloudCatalog(
        db,
        [
          cloudItem({
            itemId: 'document-skills',
            kind: 'plugin',
            latestVersionManifestJson: JSON.stringify({
              marketplaceRepo: 'anthropics/skills',
              marketplaceName: 'anthropic-agent-skills',
              pluginName: 'document-skills',
            }),
          }),
          // No dead Get buttons: a plugin without a delegate descriptor
          // never surfaces.
          cloudItem({ itemId: 'broken-plugin', kind: 'plugin', latestVersionManifestJson: '{}' }),
        ],
        new Date(),
      )
      const merged = resolveMergedCatalog(db)
      const plugin = merged.find((i) => i.itemId === 'document-skills')
      expect(plugin?.kind).toBe('plugin')
      expect(plugin?.pluginKey).toBe('document-skills@anthropic-agent-skills')
      expect(merged.some((i) => i.itemId === 'broken-plugin')).toBe(false)
    })
  })

  it('annotates the deduped cloud row installed when the skill is installed (no double-count)', async () => {
    await withTestDatabase(async (db) => {
      syncCloudCatalog(db, [cloudItem({ itemId: 'email-drafter' })], new Date())
      const items = listMarketplaceItems(
        db,
        { userId: 'u', surface: 'workspace', workspaceId: 'w' },
        {
          listInstalledSkills: () => [
            { id: 'i1', skillId: 'email-drafter', workspaceId: null, scope: 'user', versionInstalled: '1.0.0' },
          ],
          listInstalledAgents: () => [],
          listInstalledPlugins: () => [],
          listInstalledMcpServers: () => [],
          listInstalledRules: () => [],
          listClaudeMarketplaces: () => [],
        },
      )
      const drafter = items.filter((i) => i.itemId === 'email-drafter')
      expect(drafter).toHaveLength(1)
      expect(drafter[0]?.installStatus.kind).toBe('installed')
    })
  })

  it('annotates a cloud AGENT row installed via the injected agents reader', async () => {
    await withTestDatabase(async (db) => {
      syncCloudCatalog(db, [cloudItem({ itemId: 'focus-writer', kind: 'agent' })], new Date())
      const items = listMarketplaceItems(
        db,
        { userId: 'u', surface: 'workspace', workspaceId: 'w' },
        {
          listInstalledSkills: () => [],
          listInstalledAgents: () => [
            { id: 'a1', slug: 'focus-writer', workspaceId: 'w', source: 'community' },
          ],
          listInstalledPlugins: () => [],
          listInstalledMcpServers: () => [],
          listInstalledRules: () => [],
          listClaudeMarketplaces: () => [],
        },
      )
      const agent = items.find((i) => i.itemId === 'focus-writer')
      expect(agent?.kind).toBe('agent')
      expect(agent?.installStatus).toEqual({
        kind: 'installed',
        scope: 'workspace',
        installedId: 'a1',
        versionInstalled: null,
      })
    })
  })

  it('clearing the cache drops the cloud contribution but keeps bundled items', async () => {
    await withTestDatabase(async (db) => {
      syncCloudCatalog(db, [cloudItem({ itemId: 'pro-skill' })], new Date())
      expect(resolveMergedCatalog(db).map((i) => i.itemId)).toContain('pro-skill')
      clearCachedCloudCatalog(db)
      const ids = resolveMergedCatalog(db).map((i) => i.itemId)
      expect(ids).not.toContain('pro-skill')
      // The bundled email-drafter survives.
      expect(ids).toContain('email-drafter')
    })
  })
})
