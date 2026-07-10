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
    displayName: over.itemId,
    oneLineDescription: 'x',
    category: 'email',
    iconName: 'mail',
    recommendedScope: 'user',
    minimumTier: 'basic',
    latestVersion: '1.0.0',
    latestVersionSha256: 'a'.repeat(64),
    releasedAt: '2026-07-10T00:00:00.000Z',
    canInstall: true,
    ...over,
  }
}

describe('cloud catalog merge', () => {
  it('dedups the bundled+cloud collision (cloud-wins) and filters non-skill kinds', async () => {
    await withTestDatabase(async (db) => {
      syncCloudCatalog(
        db,
        [
          cloudItem({ itemId: 'email-drafter', displayName: 'Email Drafter (Cloud)' }),
          cloudItem({ itemId: 'pro-skill', displayName: 'Pro Skill', minimumTier: 'pro' }),
          cloudItem({ itemId: 'some-agent', kind: 'agent' }),
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
      // Non-skill kinds don't fit the skill-shaped MarketplaceItem yet.
      expect(merged.map((i) => i.itemId)).not.toContain('some-agent')
    })
  })

  it('annotates the deduped cloud row installed when the skill is installed (no double-count)', async () => {
    await withTestDatabase(async (db) => {
      syncCloudCatalog(db, [cloudItem({ itemId: 'email-drafter' })], new Date())
      const items = listMarketplaceItems(
        db,
        { userId: 'u', workspaceId: 'w' },
        {
          listInstalledSkills: () => [
            { id: 'i1', skillId: 'email-drafter', workspaceId: null, scope: 'user', versionInstalled: '1.0.0' },
          ],
        },
      )
      const drafter = items.filter((i) => i.itemId === 'email-drafter')
      expect(drafter).toHaveLength(1)
      expect(drafter[0]?.installStatus.kind).toBe('installed')
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
