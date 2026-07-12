// The catalog's ADMIN lifecycle — what cloud-admin-web manages. Unlike browse
// (published-only, tier-annotated), the admin view carries every status and
// every version. Lifecycle is soft-only by design: a version is byte-immutable
// once published, so removal = yank (hide + block downloads), never delete —
// deleting bytes would make already-installed copies unverifiable and burn the
// version number anyway (module notes `cloud-admin-web.md`).

import { z } from 'zod'
import { NotFoundError } from '@vynel/errors'
import type { CloudDatabase } from '@vynel/cloud-db'
import type { HubAdminCatalogItem } from '@vynel/contracts/hub/admin'
import type { HubItemKind, HubItemStatus, HubRecommendedScope } from '@vynel/contracts/hub/catalog'
import {
  findCatalogItemById,
  listAllItemsWithPublisher,
  listVersionsForItem,
  setCatalogItemStatus,
  updateCatalogItemMetadata as updateCatalogItemMetadataRow,
  type CatalogItemWithPublisher,
} from './repositories/catalog-repository.js'
import { normalizeTier, toHubCatalogVersion } from './registry-mappers.js'
import type { ItemVersionRow } from './schema/item-versions.js'

// The DB column is plain text; publish validates at write time, but the wire
// contract promises the enum — coerce legacy/unknown rows here, in one home.
function normalizeScope(raw: string | null): HubRecommendedScope | null {
  return raw === 'user' || raw === 'workspace' || raw === 'both' ? raw : null
}

function toHubAdminCatalogItem(
  joined: CatalogItemWithPublisher,
  versions: ItemVersionRow[],
): HubAdminCatalogItem {
  const { item, publisher } = joined
  return {
    itemId: item.itemId,
    kind: item.kind as HubItemKind,
    status: item.status as HubItemStatus,
    publisherId: publisher.id,
    publisherName: publisher.name,
    publisherTier: publisher.tier === 'community' ? 'community' : 'verified',
    displayName: item.displayName,
    oneLineDescription: item.oneLineDescription,
    category: item.category,
    iconName: item.iconName,
    recommendedScope: normalizeScope(item.recommendedScope),
    minimumTier: normalizeTier(item.minimumTier),
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    versions: versions.map(toHubCatalogVersion),
  }
}

export async function listCatalogForAdmin(db: CloudDatabase): Promise<HubAdminCatalogItem[]> {
  const joined = await listAllItemsWithPublisher(db)
  const items: HubAdminCatalogItem[] = []
  for (const row of joined) {
    items.push(toHubAdminCatalogItem(row, await listVersionsForItem(db, row.item.itemId)))
  }
  return items
}

export const UpdateCatalogItemMetadataSchema = z
  .object({
    displayName: z.string().min(1).max(120).optional(),
    // Max matches publish-input.ts — a published 280-char description must
    // round-trip the edit form.
    oneLineDescription: z.string().min(1).max(280).optional(),
    category: z.string().min(1).max(60).optional(),
    iconName: z.string().min(1).max(60).optional(),
    recommendedScope: z.enum(['user', 'workspace', 'both']).nullable().optional(),
    minimumTier: z.enum(['basic', 'pro']).optional(),
  })
  // An empty patch is a caller bug, not a no-op success.
  .refine((patch) => Object.keys(patch).length > 0, { message: 'The patch is empty.' })

export type UpdateCatalogItemMetadataPatch = z.infer<typeof UpdateCatalogItemMetadataSchema>

export async function updateCatalogItemMetadata(
  db: CloudDatabase,
  itemId: string,
  patch: UpdateCatalogItemMetadataPatch,
): Promise<void> {
  const item = await findCatalogItemById(db, itemId)
  if (item === null) throw new NotFoundError('catalog item', itemId)
  await updateCatalogItemMetadataRow(db, itemId, patch)
}

export const CatalogItemStatusSchema = z.enum(['draft', 'published', 'yanked'])

/** Flip an item's lifecycle status. Yank = disappears from browse AND the
 *  download gate refuses it (`authorizeCatalogDownload` requires 'published')
 *  — distribution stops instantly; installed copies keep verifying. */
export async function setCatalogItemLifecycleStatus(
  db: CloudDatabase,
  input: { readonly itemId: string; readonly status: HubItemStatus },
): Promise<void> {
  const item = await findCatalogItemById(db, input.itemId)
  if (item === null) throw new NotFoundError('catalog item', input.itemId)
  await setCatalogItemStatus(db, { itemId: input.itemId, status: input.status })
}
