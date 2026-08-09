// A user-registered Claude-native marketplace's plugins → shelf rows.
// Community-tier BY CONSTRUCTION (never Official — the hub stays the only
// curated door); itemId is the pluginKey (`<plugin>@<marketplace>`), which
// can never collide with a kebab hub id and IS the install-status anchor
// the existing plugin machinery matches on. Scope forced 'user' like every
// plugin row (off the workspace surface and its non-carded install tool).

import type { MarketplaceItem } from '@vynel/contracts/marketplace/marketplace-item'
import type { ClaudeMarketplaceSourceView } from './marketplace-types.js'

// Registration date is the honest ceiling of what we know; the shelf sorts
// 'newest' by this, so an unparsable value falls back to the epoch (sorts
// last, never throws).
const EPOCH_ISO = '1970-01-01T00:00:00.000Z'

export function claudeMarketplaceItems(
  sources: readonly ClaudeMarketplaceSourceView[],
): MarketplaceItem[] {
  return sources.flatMap((source) =>
    source.plugins.map((plugin): MarketplaceItem => {
      const pluginKey = `${plugin.pluginName}@${source.marketplaceName}`
      return {
        itemId: pluginKey,
        kind: 'plugin',
        source: { kind: 'claude-marketplace', marketplaceName: source.marketplaceName },
        skillId: pluginKey,
        publisherTier: 'community',
        publisherName: source.ownerName ?? source.marketplaceName,
        publisherUrl: null,
        sourceUrl: source.sourceUrl,
        displayName: plugin.pluginName,
        oneLineDescription: plugin.description ?? 'A plugin from this marketplace.',
        category: plugin.category ?? 'plugins',
        // No icon vocabulary exists for third-party rows — the card falls
        // back to the monogram for a non-allowlisted name.
        iconName: 'package',
        version: plugin.version ?? '0.0.0',
        releasedAt: EPOCH_ISO,
        recommendedScope: 'user',
        scope: 'user',
        isOfficial: false,
        pluginKey,
        hasCloudArtifact: false,
        installStatus: { kind: 'not-installed' },
      }
    }),
  )
}
