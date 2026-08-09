// Cache row → the `MarketplaceItem` the UI renders. `skillId === itemId`
// for every kind (the id anchor, not skill-semantics — see the contract's
// D7 note). Non-installable kinds (mcp/rule) are filtered out upstream in
// `resolveMergedCatalog`; skill/agent/plugin rows reach here — a plugin
// row is FORCED to user scope (see below).

import { toHubPublisherTier } from '@vynel/contracts/hub/catalog'
import { parsePluginItemManifest } from '@vynel/contracts/marketplace/plugin-item-manifest'
import {
  parseMcpItemManifest,
  toMcpItemAuthView,
} from '@vynel/contracts/marketplace/mcp-item-manifest'
import type {
  MarketplaceItem,
  MarketplaceItemKind,
  MarketplaceItemScope,
} from '@vynel/contracts/marketplace/marketplace-item'
import type { SkillScope } from '@vynel/contracts/skills/verified-skills/verified-skill-definition'
import type { MarketplaceCloudCatalogRow } from './schema/cloud-catalog-cache.js'

// The cache stores the hub's tier text verbatim, so parsing it is HUB
// vocabulary — the shared `toHubPublisherTier` is the one home. Its union is
// structurally identical to the desktop's `PublisherTier`, so no re-map.

function toItemKind(raw: string): MarketplaceItemKind {
  return raw === 'agent' || raw === 'plugin' || raw === 'mcp' || raw === 'rule' ? raw : 'skill'
}

// The cache row's `recommendedScope` text doubles as the hub's SURFACING
// scope (user/workspace/both after the hub-side scope rollout). A null or
// unknown value maps to 'both': legacy hub rows predate the scope semantics,
// and a legacy item must never vanish from either marketplace surface just
// because its publisher hasn't re-edited it.
function toItemScope(raw: string | null): MarketplaceItemScope {
  return raw === 'user' || raw === 'workspace' ? raw : 'both'
}

export function cloudRowToMarketplaceItem(row: MarketplaceCloudCatalogRow): MarketplaceItem {
  const kind = toItemKind(row.kind)
  // Plugin rows precompute Claude Code's registry key from the delegate
  // manifest — the install-status match anchor. Unparsable manifest =
  // undefined; the merge drops such rows (no dead Get buttons).
  const pluginManifest =
    kind === 'plugin' ? parsePluginItemManifest(row.latestVersionManifestJson) : null
  // Mcp rows precompute the config's server-name key the same way — the
  // manifest IS the install (config-is-truth), so an unparsable one means
  // the item cannot install at all and the merge drops it.
  const mcpManifest = kind === 'mcp' ? parseMcpItemManifest(row.latestVersionManifestJson) : null
  const mcpAuth = mcpManifest !== null ? toMcpItemAuthView(mcpManifest) : null
  return {
    itemId: row.itemId,
    kind,
    source: { kind: 'vynel-catalog' },
    skillId: row.itemId,
    publisherTier: toHubPublisherTier(row.publisherTier),
    publisherName: row.publisherName,
    publisherUrl: row.publisherUrl,
    sourceUrl: row.sourceUrl,
    displayName: row.displayName,
    oneLineDescription: row.oneLineDescription,
    // Verbatim: categories are admin-defined on the hub (open string) — the
    // old silent coercion to 'context' hid every new category from users.
    category: row.category,
    iconName: row.iconName,
    version: row.latestVersion,
    releasedAt: row.releasedAt,
    // The install picker's default only — a 'both' surfacing scope still
    // needs one concrete SkillScope to suggest, and 'user' matches what a
    // 'both' item most often is (useful everywhere).
    recommendedScope: (row.recommendedScope === 'workspace' && kind !== 'plugin'
      ? 'workspace'
      : 'user') as SkillScope,
    // Move C: plugins surface on BOTH shelves (workspace installs are
    // project-scope — confining their context cost). The old structural
    // wall (the non-carded workspace tool must never run the CLI
    // delegate) moved to the install body: `acceptPluginExecution` is
    // excluded from the session tool's schema, so tool calls get an
    // actionable 400 while the UI installs normally.
    scope: kind === 'plugin' ? 'both' : toItemScope(row.recommendedScope),
    // Both curated tiers badge as official — 'verified' (Vynel Team) and
    // 'anthropic-official' (upstream Anthropic). Only community rows don't.
    isOfficial: toHubPublisherTier(row.publisherTier) !== 'community',
    ...(pluginManifest !== null
      ? { pluginKey: `${pluginManifest.pluginName}@${pluginManifest.marketplaceName}` }
      : {}),
    ...(mcpManifest !== null ? { mcpServerName: mcpManifest.serverName } : {}),
    // The card needs the auth requirement BEFORE install (configure dialog /
    // connect step) — derived here so the UI never parses manifests.
    ...(mcpAuth !== null ? { mcpAuth } : {}),
    // Only skill rows have an artifact the UPDATE route will serve —
    // agents update by uninstall+reinstall, plugins via the CLI delegate
    // (their update slice is a recorded Arc-3 item; widen this then).
    hasCloudArtifact: kind === 'skill',
    installStatus: { kind: 'not-installed' },
    minimumTier: row.minimumTier === 'pro' ? 'pro' : 'basic',
  }
}
