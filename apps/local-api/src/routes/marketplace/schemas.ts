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

const MarketplaceItemInstallStatusSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('not-installed') }),
  z.object({
    kind: z.literal('installed'),
    scope: SkillScopeSchema,
    installedSkillId: z.string(),
    versionInstalled: z.string(),
  }),
])

export const MarketplaceItemSchema = z.object({
  itemId: z.string(),
  skillId: z.string(),
  publisherTier: PublisherTierSchema,
  publisherName: z.string(),
  publisherUrl: z.string().nullable(),
  displayName: z.string(),
  oneLineDescription: z.string(),
  category: SkillCategorySchema,
  iconName: z.string(),
  version: z.string(),
  releasedAt: z.string(),
  recommendedScope: SkillScopeSchema,
  isOfficial: z.boolean(),
  installStatus: MarketplaceItemInstallStatusSchema,
  // Cloud items only — the UI's "Pro" badge (display); bundled items omit it.
  minimumTier: z.enum(['basic', 'pro']).optional(),
})

export const ListMarketplaceItemsResponseSchema = z.array(MarketplaceItemSchema)

export const InstallMarketplaceItemBodySchema = z.object({
  itemId: z.string().min(1).max(200),
  scope: SkillScopeSchema,
})

export const InstallMarketplaceItemResponseSchema = z.object({
  installedSkillId: z.string(),
  itemId: z.string(),
  scope: SkillScopeSchema,
  source: z.enum(['verified-catalog', 'marketplace', 'external']),
  version: z.string(),
})
