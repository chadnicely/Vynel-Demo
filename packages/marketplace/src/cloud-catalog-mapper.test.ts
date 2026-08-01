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
    sourceUrl: 'https://github.com/anthropics/skills/tree/b29e7cf/skills/canvas-design',
    displayName: 'Canvas Design',
    oneLineDescription: 'Create visual art as png/pdf.',
    category: 'context',
    iconName: 'palette',
    recommendedScope: 'both',
    minimumTier: 'basic',
    latestVersion: '1.0.0',
    latestVersionManifestJson: null,
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
    // The credit line's provenance rides through untouched.
    expect(item.sourceUrl).toBe(
      'https://github.com/anthropics/skills/tree/b29e7cf/skills/canvas-design',
    )
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

  it('renders an admin-defined category VERBATIM — never coerced to a known one', () => {
    // The regression this pins: unknown categories used to silently become
    // 'context', hiding every new admin-defined category from users.
    expect(cloudRowToMarketplaceItem(cacheRow({ category: 'data-science' })).category).toBe(
      'data-science',
    )
    expect(cloudRowToMarketplaceItem(cacheRow({ category: 'creative' })).category).toBe('creative')
  })

  it('mcp row: precomputes the server name from a parsable manifest; unparsable stays undefined', () => {
    const parsable = cloudRowToMarketplaceItem(
      cacheRow({
        itemId: 'playwright-mcp',
        kind: 'mcp',
        latestVersionManifestJson: JSON.stringify({
          serverName: 'playwright',
          transport: 'stdio',
          commandOrUrl: 'npx',
          args: ['@playwright/mcp@latest'],
        }),
      }),
    )
    expect(parsable.kind).toBe('mcp')
    expect(parsable.mcpServerName).toBe('playwright')
    // Config entries carry no downloadable artifact — never an Update button.
    expect(parsable.hasCloudArtifact).toBe(false)

    const broken = cloudRowToMarketplaceItem(
      cacheRow({ itemId: 'broken-mcp', kind: 'mcp', latestVersionManifestJson: '{"nope":1}' }),
    )
    expect(broken.mcpServerName).toBeUndefined()
  })
})
