// The cache-row → MarketplaceItem narrowing, with the publisher-tier truth
// table: both curated tiers ('verified', 'anthropic-official') badge as
// official; community doesn't; unknown legacy text falls back to 'verified'.

import { describe, it, expect } from 'vitest'
import type { MarketplaceCloudCatalogRow } from './schema/cloud-catalog-cache.js'
import { cloudRowToMarketplaceItem } from './cloud-catalog-mapper.js'

function cacheRow(over: Partial<MarketplaceCloudCatalogRow> = {}): MarketplaceCloudCatalogRow {
  return {
    itemId: 'canvas-design',
    kind: 'skill',
    publisherName: 'Anthropic',
    publisherTier: 'anthropic-official',
    publisherUrl: 'https://anthropic.com',
    displayName: 'Canvas Design',
    oneLineDescription: 'Create visual art as png/pdf.',
    category: 'context',
    iconName: 'palette',
    recommendedScope: 'both',
    minimumTier: 'basic',
    latestVersion: '1.0.0',
    latestVersionSha256: 'a'.repeat(64),
    releasedAt: '2026-08-01T00:00:00.000Z',
    syncedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...over,
  }
}

describe('cloudRowToMarketplaceItem', () => {
  it('passes anthropic-official through and badges it official', () => {
    const item = cloudRowToMarketplaceItem(cacheRow())
    expect(item.publisherTier).toBe('anthropic-official')
    expect(item.isOfficial).toBe(true)
  })

  it('keeps verified official and community unofficial', () => {
    expect(cloudRowToMarketplaceItem(cacheRow({ publisherTier: 'verified' }))).toMatchObject({
      publisherTier: 'verified',
      isOfficial: true,
    })
    expect(cloudRowToMarketplaceItem(cacheRow({ publisherTier: 'community' }))).toMatchObject({
      publisherTier: 'community',
      isOfficial: false,
    })
  })

  it('falls back to verified for unknown legacy tier text', () => {
    const item = cloudRowToMarketplaceItem(cacheRow({ publisherTier: 'partner' }))
    expect(item.publisherTier).toBe('verified')
    expect(item.isOfficial).toBe(true)
  })
})
