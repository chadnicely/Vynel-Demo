// The full publish use-case: validate the artifact bytes, hash them, store
// them, and record the version — the one home for "a new catalog version
// exists". The admin route only decodes the transport (base64) and calls this.

import { createHash } from 'node:crypto'
import { ConflictError, ValidationError } from '@vynel/errors'
import type { CloudDatabase } from '@vynel/cloud-db'
import type { PublishItemInput } from './publish-input.js'
import { publishItemVersion, type PublishResult } from './publish-item-version.js'
import { findItemVersion } from './repositories/catalog-repository.js'
import { artifactKey, type ArtifactStore } from './artifact-store.js'

export const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024

export interface PublishCatalogArtifactInput extends PublishItemInput {
  /** The artifact zip's raw bytes (the route decodes the base64 transport). */
  readonly artifactBytes: Buffer
}

export async function publishCatalogArtifact(
  db: CloudDatabase,
  artifactStore: ArtifactStore,
  input: PublishCatalogArtifactInput,
): Promise<PublishResult> {
  const bytes = input.artifactBytes
  if (bytes.length === 0 || bytes.length > MAX_ARTIFACT_BYTES) {
    throw new ValidationError('Artifact is empty or exceeds the 10MB limit.')
  }
  const artifactSha256 = createHash('sha256').update(bytes).digest('hex')

  // Conflict-check BEFORE the put: versions are byte-immutable. Storing first
  // would overwrite an existing version's bytes even though the DB write is
  // then refused with 409 — leaving stored bytes that no longer match the
  // recorded sha256 (the desktop install would reject them).
  const existing = await findItemVersion(db, {
    itemId: input.item.itemId,
    version: input.version.version,
  })
  if (existing !== null) {
    throw new ConflictError(
      `${input.item.itemId}@${input.version.version} is already published — bump the version.`,
    )
  }

  await artifactStore.put(artifactKey(input.item.itemId, input.version.version), bytes)
  return publishItemVersion(db, input, { artifactSha256, artifactSize: bytes.length })
}
