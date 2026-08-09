// The full publish use-case: validate + INSPECT the artifact bytes (the hub
// never records a zip it hasn't looked inside — traversal/symlink/bomb
// entries are refused here, covering the direct upload AND the from-repo
// path), hash them, store them, and record the version — the one home for
// "a new catalog version exists". The admin route only decodes the
// transport (base64) and calls this.

import { createHash } from 'node:crypto'
import { ConflictError, ValidationError } from '@vynel/errors'
import { MAX_ARTIFACT_BYTES } from '@vynel/contracts/hub/artifact-archive-rules'
import type { CloudDatabase } from '@vynel/cloud-db'
import type { PublishItemInput } from './publish-input.js'
import { publishItemVersion, type PublishResult } from './publish-item-version.js'
import { findItemVersion } from './repositories/catalog-repository.js'
import { artifactKey, type ArtifactStore } from './artifact-store.js'
import { inspectArtifactArchive } from './inspect-artifact-archive.js'
import { assertMcpServerNameUnique } from './assert-mcp-server-name-unique.js'
import type { ArtifactSigner } from './artifact-signer.js'

export { MAX_ARTIFACT_BYTES }

export interface PublishCatalogArtifactInput extends PublishItemInput {
  /** The artifact zip's raw bytes (the route decodes the base64 transport). */
  readonly artifactBytes: Buffer
}

export async function publishCatalogArtifact(
  db: CloudDatabase,
  artifactStore: ArtifactStore,
  input: PublishCatalogArtifactInput,
  // Absent on a hub without CLOUD_ARTIFACT_SIGNING_PRIVATE_KEY — the version
  // publishes unsigned and the desktop verifies-if-present.
  signer?: ArtifactSigner,
): Promise<PublishResult> {
  const bytes = input.artifactBytes
  if (bytes.length === 0 || bytes.length > MAX_ARTIFACT_BYTES) {
    throw new ValidationError('Artifact is empty or exceeds the 10MB limit.')
  }
  await inspectArtifactArchive(bytes)
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

  // Every publish path (upload, from-repo, import) funnels through here,
  // so this wall is the whole enforcement of the mcp serverName rule.
  if (input.item.kind === 'mcp') {
    await assertMcpServerNameUnique(db, {
      itemId: input.item.itemId,
      manifest: input.version.manifest,
    })
  }

  await artifactStore.put(artifactKey(input.item.itemId, input.version.version), bytes)
  return publishItemVersion(db, input, {
    artifactSha256,
    artifactSignature: signer?.sign(artifactSha256) ?? null,
    artifactSize: bytes.length,
  })
}
