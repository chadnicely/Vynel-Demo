// Type definitions for the `marketplace` domain. The domain owns no
// DB tables (D1) — types live entirely in `@vynel/contracts`. Per
// `contracts-exports-map`, consumers import the file directly
// (`@vynel/contracts/marketplace/marketplace-item`); no barrel.

import type { SkillScope } from '../skills/verified-skills/verified-skill-definition.js'

/** Phase 1 emits only `'verified'`; the other two are reserved for
 * Phase 1.5+ items. Closed union — the UI compiles against all three
 * badge variants from day one. Per D3. */
export type PublisherTier = 'verified' | 'anthropic-official' | 'community'

/** Sort modes the UI offers (no `'updated'` under MINIMAL per D8 —
 * no update flow in Phase 1). */
export type MarketplaceSortKey = 'recommended' | 'name-asc' | 'newest'

/** Where a catalog item SURFACES (Chad's rule: any item is user-level,
 * workspace-level, or both). 'user' shows only on the GLOBAL marketplace
 * (installs at user scope), 'workspace' only on each workspace's
 * marketplace, 'both' on the two surfaces alike. Distinct from
 * `recommendedScope` (the install picker's default) and from
 * `installStatus.scope` (where an installed row actually lives). */
export type MarketplaceItemScope = 'user' | 'workspace' | 'both'

/** The marketplace surface a browse/install request comes from: the
 * GLOBAL menu ('global' — user-scope installs) or one workspace's
 * drawer ('workspace' — today's behavior). */
export type MarketplaceSurface = 'global' | 'workspace'

/** The surface selector list/get take — the workspace surface carries
 * its workspace id, the global surface has none (illegal states
 * unrepresentable). */
export type MarketplaceSurfaceSelector =
  | { surface: 'global' }
  | { surface: 'workspace'; workspaceId: string }

/** The DESKTOP's item-kind union — every hub kind now installs. Slice
 * C-agents; `mcp` + `rule` landed 2026-08-02 (config-is-truth: the
 * Claude config entry / the `.claude/rules/<id>.md` file IS the
 * installed state). */
export type MarketplaceItemKind = 'skill' | 'agent' | 'plugin' | 'mcp' | 'rule'

/** Install-status discriminator. Phase 1 has two variants (no
 * `'installed-with-update-available'` per D8). Generalized when the
 * `agent` kind landed (C-agents): `installedId` is the installed row's
 * id in its owning leaf (`installed_skills.id` / `agents.id`);
 * `versionInstalled` is null for agents — agent rows don't record the
 * installed version (the update flow is a deferred arc). */
export type MarketplaceItemInstallStatus =
  | { kind: 'not-installed' }
  | {
      kind: 'installed'
      scope: SkillScope
      installedId: string
      versionInstalled: string | null
    }

/** A catalog row, always annotated with install status. `skillId`
 * stays `=== itemId` for every row today — the id anchor, not
 * skill-semantics (see D7); agent items anchor on itemId === the
 * manifest slug, enforced at install. */
export type MarketplaceItem = {
  itemId: string
  kind: MarketplaceItemKind
  skillId: string
  publisherTier: PublisherTier
  publisherName: string
  publisherUrl: string | null
  /** Upstream origin of the item's content (credit line's Source link) —
   * e.g. the pinned anthropics/skills folder; null when Vynel-authored. */
  sourceUrl: string | null
  displayName: string
  oneLineDescription: string
  /** Open string — categories are admin-defined on the hub (2026-08-02);
   * the UI renders them verbatim and derives filters from the data. The
   * closed `SkillCategory` union stays for the BUNDLED verified catalog. */
  category: string
  iconName: string
  version: string
  releasedAt: string
  recommendedScope: SkillScope
  /** Surfacing scope — which marketplace surface(s) list this item. */
  scope: MarketplaceItemScope
  isOfficial: boolean
  /** Plugin items only: `<pluginName>@<marketplaceName>` — Claude Code's
   * registry key, precomputed from the item manifest. The install-status
   * match anchor (full key, never bare name — a same-named plugin from
   * another marketplace must not cross-match). */
  pluginKey?: string
  /** Mcp items only: the entry key inside the Claude config's `mcpServers`
   * map — the install-status match anchor (config-is-truth: presence of
   * this key in the scope's config IS the installed state). */
  mcpServerName?: string
  /** True only when the hub carries a downloadable artifact the update
   * route can serve (a cloud-cached SKILL item). Bundled-only items
   * version with app releases — nothing newer to download — so the card
   * gates its Update button on this instead of showing one the daemon
   * would 400. */
  hasCloudArtifact: boolean
  installStatus: MarketplaceItemInstallStatus
  /** Cloud items only: the access tier required to INSTALL. The UI shows a
   * "Pro" badge from this vs the current entitlement (display only — the real
   * gate is server-side fail-closed at download). Bundled items omit it. */
  minimumTier?: 'basic' | 'pro'
}

export type MarketplaceFilterInput = {
  items: MarketplaceItem[]
  category?: string
  publisherTier?: PublisherTier
  installState?: 'installed' | 'not-installed'
  searchQuery?: string
  sortBy?: MarketplaceSortKey
}

export type ListMarketplaceItemsInput = {
  userId: string
  category?: string
  publisherTier?: PublisherTier
  installState?: 'installed' | 'not-installed'
  searchQuery?: string
  sortBy?: MarketplaceSortKey
} & MarketplaceSurfaceSelector
