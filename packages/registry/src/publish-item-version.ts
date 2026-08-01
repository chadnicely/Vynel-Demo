// Publish a catalog item version: upsert the publisher + item, then insert
// the version carrying the artifact's sha256 + size (computed by the route
// from the uploaded bytes). Republishing an existing (itemId, version) is a
// conflict — versions are immutable once published.

import { randomUUID } from 'node:crypto'
import { ConflictError } from '@vynel/errors'
import type { CloudDatabase } from '@vynel/cloud-db'
import type { PublishItemInput } from './publish-input.js'
import { upsertPublisher } from './repositories/publishers-repository.js'
import {
  findItemVersion,
  insertItemVersion,
  upsertCatalogItem,
} from './repositories/catalog-repository.js'

export interface PublishArtifactFacts {
  readonly artifactSha256: string
  /** Base64 Ed25519 signature over the sha256 hex; null on a hub without a
   *  signing key (the desktop verifies-if-present). */
  readonly artifactSignature: string | null
  readonly artifactSize: number
}

export interface PublishResult {
  readonly itemId: string
  readonly version: string
}

export async function publishItemVersion(
  db: CloudDatabase,
  input: PublishItemInput,
  artifact: PublishArtifactFacts,
): Promise<PublishResult> {
  const existing = await findItemVersion(db, {
    itemId: input.item.itemId,
    version: input.version.version,
  })
  if (existing !== null) {
    throw new ConflictError(
      `${input.item.itemId}@${input.version.version} is already published — bump the version.`,
    )
  }

  // One transaction: publisher + item + version land together or not at all
  // (no version-less item row on a partial failure).
  await db.transaction(async (tx) => {
    await upsertPublisher(tx, {
      id: input.publisher.id,
      name: input.publisher.name,
      tier: input.publisher.tier,
      url: input.publisher.url ?? null,
    })
    await upsertCatalogItem(tx, {
      itemId: input.item.itemId,
      kind: input.item.kind,
      publisherId: input.publisher.id,
      displayName: input.item.displayName,
      oneLineDescription: input.item.oneLineDescription,
      category: input.item.category,
      iconName: input.item.iconName,
      recommendedScope: input.item.recommendedScope ?? null,
      sourceUrl: input.item.sourceUrl ?? null,
      minimumTier: input.item.minimumTier,
      status: input.item.status,
    })
    await insertItemVersion(tx, {
      id: randomUUID(),
      itemId: input.item.itemId,
      version: input.version.version,
      changelog: input.version.changelog,
      manifestJson: JSON.stringify(input.version.manifest),
      artifactSha256: artifact.artifactSha256,
      artifactSignature: artifact.artifactSignature,
      artifactSize: artifact.artifactSize,
      minAppVersion: input.version.minAppVersion ?? null,
    })
  })
  return { itemId: input.item.itemId, version: input.version.version }
}
