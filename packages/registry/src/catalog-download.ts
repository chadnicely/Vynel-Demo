// The tier-gated download decision + the artifact read — the fail-CLOSED half
// of the §5 "browse generous, install gated" line. `authorizeCatalogDownload`
// makes every gate decision (no live account → denied, unpublished → not
// found, tier below the item's minimum → denied) and hands back the version's
// integrity facts so the route can answer conditional requests (ETag/304)
// WITHOUT touching the artifact bytes; `loadCatalogArtifact` then reads them.

import { NotFoundError, VynelError } from '@vynel/errors'
import type { CloudDatabase } from '@vynel/cloud-db'
import type { HubTier } from '@vynel/contracts/hub/entitlements'
import { tierMeetsMinimum } from '@vynel/contracts/hub/catalog'
import { findCatalogItemById, findItemVersion } from './repositories/catalog-repository.js'
import { artifactKey, type ArtifactStore } from './artifact-store.js'

export class TierTooLowError extends VynelError {
  readonly code = 'tier_too_low'
  readonly httpStatus = 403
}

export class ArtifactMissingError extends VynelError {
  readonly code = 'artifact_missing'
  readonly httpStatus = 404
}

export interface AuthorizeCatalogDownloadInput {
  readonly itemId: string
  readonly version: string
  /** The caller's LIVE tier — null when no active account stands behind the
   *  (validly-signed) token; a deleted/disabled account may not download. */
  readonly callerTier: HubTier | null
}

export interface AuthorizedCatalogDownload {
  /** The version's recorded sha256 — a strong ETag for the route. */
  readonly artifactSha256: string
  /** Base64 Ed25519 signature over the sha256 hex; null for versions
   *  published before the hub had a signing key. */
  readonly artifactSignature: string | null
  readonly artifactSize: number
}

export async function authorizeCatalogDownload(
  db: CloudDatabase,
  input: AuthorizeCatalogDownloadInput,
): Promise<AuthorizedCatalogDownload> {
  if (input.callerTier === null) {
    throw new TierTooLowError('This account can’t install marketplace items.')
  }
  const item = await findCatalogItemById(db, input.itemId)
  if (item === null || item.status !== 'published') {
    throw new NotFoundError('catalog item', input.itemId)
  }
  const minimumTier: HubTier = item.minimumTier === 'pro' ? 'pro' : 'basic'
  if (!tierMeetsMinimum(input.callerTier, minimumTier)) {
    throw new TierTooLowError(`Installing ${item.displayName} needs the ${minimumTier} plan.`)
  }
  const versionRow = await findItemVersion(db, {
    itemId: input.itemId,
    version: input.version,
  })
  if (versionRow === null) {
    throw new NotFoundError('catalog item version', `${input.itemId}@${input.version}`)
  }
  return {
    artifactSha256: versionRow.artifactSha256,
    artifactSignature: versionRow.artifactSignature,
    artifactSize: versionRow.artifactSize,
  }
}

/** Read an AUTHORIZED version's bytes. Missing bytes for a recorded version is
 *  a storage integrity fault (surfaced, never a silent empty download). */
export async function loadCatalogArtifact(
  artifactStore: ArtifactStore,
  input: { readonly itemId: string; readonly version: string },
): Promise<Buffer> {
  const bytes = await artifactStore.get(artifactKey(input.itemId, input.version))
  if (bytes === null) {
    throw new ArtifactMissingError('Artifact bytes are missing from storage.')
  }
  return bytes
}
