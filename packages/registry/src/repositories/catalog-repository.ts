// Functional catalog repository — items + their versions. `db` first arg,
// stateless, async.

import { and, desc, eq } from 'drizzle-orm'
import type { CloudDatabase } from '@vynel/cloud-db'
import { catalogItems, type CatalogItemRow } from '../schema/catalog-items.js'
import { itemVersions, type ItemVersionRow } from '../schema/item-versions.js'
import { publishers, type PublisherRow } from '../schema/publishers.js'

export interface UpsertCatalogItemInput {
  readonly itemId: string
  readonly kind: string
  readonly publisherId: string
  readonly displayName: string
  readonly oneLineDescription: string
  readonly category: string
  readonly iconName: string
  readonly recommendedScope: string | null
  readonly minimumTier: string
  readonly status: string
}

export async function upsertCatalogItem(
  db: CloudDatabase,
  input: UpsertCatalogItemInput,
): Promise<CatalogItemRow> {
  const now = new Date()
  const rows = await db
    .insert(catalogItems)
    .values({ ...input, updatedAt: now })
    .onConflictDoUpdate({
      target: catalogItems.itemId,
      set: {
        kind: input.kind,
        publisherId: input.publisherId,
        displayName: input.displayName,
        oneLineDescription: input.oneLineDescription,
        category: input.category,
        iconName: input.iconName,
        recommendedScope: input.recommendedScope,
        minimumTier: input.minimumTier,
        status: input.status,
        updatedAt: now,
      },
    })
    .returning()
  return rows[0] as CatalogItemRow
}

export async function setCatalogItemStatus(
  db: CloudDatabase,
  input: { readonly itemId: string; readonly status: string },
): Promise<void> {
  await db
    .update(catalogItems)
    .set({ status: input.status, updatedAt: new Date() })
    .where(eq(catalogItems.itemId, input.itemId))
}

export async function findCatalogItemById(
  db: CloudDatabase,
  itemId: string,
): Promise<CatalogItemRow | null> {
  const rows = await db.select().from(catalogItems).where(eq(catalogItems.itemId, itemId)).limit(1)
  return rows[0] ?? null
}

export interface CatalogItemWithPublisher {
  readonly item: CatalogItemRow
  readonly publisher: PublisherRow
}

/** Published items joined to their publisher, newest-updated first. */
export async function listPublishedItemsWithPublisher(
  db: CloudDatabase,
): Promise<CatalogItemWithPublisher[]> {
  const rows = await db
    .select({ item: catalogItems, publisher: publishers })
    .from(catalogItems)
    .innerJoin(publishers, eq(catalogItems.publisherId, publishers.id))
    .where(eq(catalogItems.status, 'published'))
    .orderBy(desc(catalogItems.updatedAt))
  return rows
}

/** EVERY item joined to its publisher regardless of status — the admin view. */
export async function listAllItemsWithPublisher(
  db: CloudDatabase,
): Promise<CatalogItemWithPublisher[]> {
  const rows = await db
    .select({ item: catalogItems, publisher: publishers })
    .from(catalogItems)
    .innerJoin(publishers, eq(catalogItems.publisherId, publishers.id))
    .orderBy(desc(catalogItems.updatedAt))
  return rows
}

export interface UpdateCatalogItemMetadataInput {
  readonly displayName?: string | undefined
  readonly oneLineDescription?: string | undefined
  readonly category?: string | undefined
  readonly iconName?: string | undefined
  readonly recommendedScope?: string | null | undefined
  readonly minimumTier?: string | undefined
}

export async function updateCatalogItemMetadata(
  db: CloudDatabase,
  itemId: string,
  patch: UpdateCatalogItemMetadataInput,
): Promise<void> {
  // Drop present-but-undefined keys (zod optionals) — only real changes land.
  const changes = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  )
  await db
    .update(catalogItems)
    .set({ ...changes, updatedAt: new Date() })
    .where(eq(catalogItems.itemId, itemId))
}

export async function findItemWithPublisher(
  db: CloudDatabase,
  itemId: string,
): Promise<CatalogItemWithPublisher | null> {
  const rows = await db
    .select({ item: catalogItems, publisher: publishers })
    .from(catalogItems)
    .innerJoin(publishers, eq(catalogItems.publisherId, publishers.id))
    .where(eq(catalogItems.itemId, itemId))
    .limit(1)
  return rows[0] ?? null
}

export interface InsertItemVersionInput {
  readonly id: string
  readonly itemId: string
  readonly version: string
  readonly changelog: string
  readonly manifestJson: string
  readonly artifactSha256: string
  readonly artifactSize: number
  readonly minAppVersion: string | null
}

export async function insertItemVersion(
  db: CloudDatabase,
  input: InsertItemVersionInput,
): Promise<ItemVersionRow> {
  const rows = await db.insert(itemVersions).values(input).returning()
  return rows[0] as ItemVersionRow
}

/** All versions of an item, newest release first. */
export async function listVersionsForItem(
  db: CloudDatabase,
  itemId: string,
): Promise<ItemVersionRow[]> {
  return db
    .select()
    .from(itemVersions)
    .where(eq(itemVersions.itemId, itemId))
    .orderBy(desc(itemVersions.releasedAt))
}

export async function findItemVersion(
  db: CloudDatabase,
  input: { readonly itemId: string; readonly version: string },
): Promise<ItemVersionRow | null> {
  const rows = await db
    .select()
    .from(itemVersions)
    .where(and(eq(itemVersions.itemId, input.itemId), eq(itemVersions.version, input.version)))
    .limit(1)
  return rows[0] ?? null
}

export async function findLatestVersionForItem(
  db: CloudDatabase,
  itemId: string,
): Promise<ItemVersionRow | null> {
  const rows = await db
    .select()
    .from(itemVersions)
    .where(eq(itemVersions.itemId, itemId))
    .orderBy(desc(itemVersions.releasedAt))
    .limit(1)
  return rows[0] ?? null
}
