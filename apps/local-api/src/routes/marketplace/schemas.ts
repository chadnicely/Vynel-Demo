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
