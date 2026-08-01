// Zod request schemas for the `marketplace` routes. Per
// `coding-standard.md` "Zod schemas" — XxxSchema suffix; API-internal
// (single consumer = apps/web) lives here under the route folder.
// Promote to `@vynel/contracts/marketplace/*` on the SECOND consumer
// per `contracts-exports-map`.
//
// Spec: blueprint §6.3.

import { z } from 'zod'

export const SkillCategorySchema = z.enum([
  'email',
  'documents',
  'calendar',
  'files',
  'research',
  'notes',
  'context',
  'creative',
  'communication',
])

export const PublisherTierSchema = z.enum(['verified', 'anthropic-official', 'community'])

export const ListMarketplaceItemsQuerySchema = z.object({
  category: SkillCategorySchema.optional(),
  publisherTier: PublisherTierSchema.optional(),
  installState: z.enum(['installed', 'not-installed']).optional(),
  searchQuery: z.string().min(0).max(200).optional(),
  sortBy: z.enum(['recommended', 'name-asc', 'newest']).optional(),
})

export const ItemIdParamSchema = z.object({
  itemId: z.string().min(1).max(200),
})

// ── Response schemas ────────────────────────────────────────────────
// The exact shape `@vynel/contracts/marketplace/marketplace-item`
// (`MarketplaceItem`) emits, mirrored here so `describeRoute`'s
// `resolver()` gives the generated SDK a real return type instead of
// `never`. `serializeMarketplaceItem` is a pass-through of that
// contract type, so this schema is a description of it, not a new
// source of truth (contrast `serializers.ts`'s note).

const SkillScopeSchema = z.enum(['user', 'workspace'])

// The item's SURFACING scope (which marketplace surface lists it) —
// distinct from the install scope above.
const MarketplaceItemScopeSchema = z.enum(['user', 'workspace', 'both'])

export const MarketplaceItemKindSchema = z.enum(['skill', 'agent', 'plugin', 'mcp', 'rule'])

const MarketplaceItemInstallStatusSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('not-installed') }),
  z.object({
    kind: z.literal('installed'),
    scope: SkillScopeSchema,
    // The installed row's id in its owning leaf (installed_skills.id /
    // agents.id); agents carry no installed version (null).
    installedId: z.string(),
    versionInstalled: z.string().nullable(),
  }),
])

export const MarketplaceItemSchema = z.object({
  itemId: z.string(),
  kind: MarketplaceItemKindSchema,
  skillId: z.string(),
  publisherTier: PublisherTierSchema,
  publisherName: z.string(),
  publisherUrl: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  displayName: z.string(),
  oneLineDescription: z.string(),
  category: SkillCategorySchema,
  iconName: z.string(),
  version: z.string(),
  releasedAt: z.string(),
  recommendedScope: SkillScopeSchema,
  scope: MarketplaceItemScopeSchema,
  isOfficial: z.boolean(),
  // Plugin items only: Claude Code's `name@marketplace` registry key.
  pluginKey: z.string().optional(),
  // Mcp items only: the entry key inside the Claude config's mcpServers map.
  mcpServerName: z.string().optional(),
  // True only when the hub carries an artifact the update route can serve —
  // the card's Update button gates on this (no dead buttons on bundled items).
  hasCloudArtifact: z.boolean(),
  installStatus: MarketplaceItemInstallStatusSchema,
  // Cloud items only — the UI's "Pro" badge (display); bundled items omit it.
  minimumTier: z.enum(['basic', 'pro']).optional(),
})

export const ListMarketplaceItemsResponseSchema = z.array(MarketplaceItemSchema)

export const InstallMarketplaceItemBodySchema = z.object({
  itemId: z.string().min(1).max(200),
  scope: SkillScopeSchema,
})

// The USER-scoped install carries no scope — the global surface always
// installs at user scope (Chad's rule), so the field would only invite
// disagreement between the route's path and its body.
export const InstallUserMarketplaceItemBodySchema = z.object({
  itemId: z.string().min(1).max(200),
})

export const UninstallMarketplaceItemBodySchema = z.object({
  itemId: z.string().min(1).max(200),
})

export const UpdateMarketplaceItemBodySchema = z.object({
  itemId: z.string().min(1).max(200),
})

// Skills only (agents have no in-place update yet) — the install response's
// skill branch, not a union.
export const UpdateMarketplaceItemResponseSchema = z.object({
  kind: z.literal('skill'),
  installedSkillId: z.string(),
  itemId: z.string(),
  scope: SkillScopeSchema,
  source: z.enum(['verified-catalog', 'marketplace', 'external']),
  version: z.string(),
})

// Mirrors the install response's kind discrimination: the uninstalled
// row's id in its owning leaf (installed_skills.id / agents.id).
export const UninstallMarketplaceItemResponseSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('skill'),
    installedSkillId: z.string(),
    itemId: z.string(),
  }),
  z.object({
    kind: z.literal('agent'),
    agentId: z.string(),
    itemId: z.string(),
  }),
  z.object({
    kind: z.literal('plugin'),
    pluginKey: z.string(),
    itemId: z.string(),
  }),
  // Config-is-truth: the removed config entry's server name IS the identity.
  z.object({
    kind: z.literal('mcp'),
    serverName: z.string(),
    itemId: z.string(),
  }),
  // Config-is-truth: the removed `.claude/rules/<id>.md` file's id.
  z.object({
    kind: z.literal('rule'),
    ruleId: z.string(),
    itemId: z.string(),
  }),
])

// Discriminated by item kind (C-agents): a skill install answers with the
// installed-skill row, an agent install with the created agent row.
export const InstallMarketplaceItemResponseSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('skill'),
    installedSkillId: z.string(),
    itemId: z.string(),
    scope: SkillScopeSchema,
    source: z.enum(['verified-catalog', 'marketplace', 'external']),
    version: z.string(),
  }),
  z.object({
    kind: z.literal('agent'),
    agentId: z.string(),
    slug: z.string(),
    itemId: z.string(),
    scope: SkillScopeSchema,
    version: z.string(),
  }),
  // Plugin installs delegate to Claude Code's plugin system — no installed
  // row of Vynel's own; the registry key is the identity.
  z.object({
    kind: z.literal('plugin'),
    pluginKey: z.string(),
    itemId: z.string(),
    version: z.string().nullable(),
  }),
  // Mcp installs write one Claude-config entry (config-is-truth) — the
  // server name is the identity; no Vynel row.
  z.object({
    kind: z.literal('mcp'),
    serverName: z.string(),
    itemId: z.string(),
    scope: SkillScopeSchema,
    version: z.string().nullable(),
  }),
  // Rule installs write one provenance-marked `.claude/rules/<id>.md`
  // (config-is-truth) — the file id is the identity; no Vynel row.
  z.object({
    kind: z.literal('rule'),
    ruleId: z.string(),
    itemId: z.string(),
    scope: SkillScopeSchema,
    version: z.string(),
  }),
])
