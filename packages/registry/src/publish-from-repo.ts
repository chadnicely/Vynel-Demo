// Publish a catalog item straight from a GitHub repo folder — the portal's
// "From GitHub URL" mode. Validate the URL against the allowlist, resolve
// the ref to a pinned sha, clone at that pin, pack the folder kind-aware
// (seed-bundle layout), and hand the bytes to `publishCatalogArtifact` — the
// one home for "a new catalog version exists" (which inspects the archive
// and signs when the hub carries a key). The item's sourceUrl defaults to
// the pin-anchored `<repo>/tree/<sha>/<subpath>` credit link.

import type { z } from 'zod'
import { ConflictError } from '@vynel/errors'
import type { CloudDatabase } from '@vynel/cloud-db'
import type { ArtifactStore } from './artifact-store.js'
import type { ArtifactSigner } from './artifact-signer.js'
import { PublishItemSchema } from './publish-input.js'
import { publishCatalogArtifact } from './publish-catalog-artifact.js'
import { findItemVersion } from './repositories/catalog-repository.js'
import { packItemFolder } from './pack-item-folder.js'
import {
  RepoSourceSchema,
  assertGithubRepoUrl,
  deriveRepoSourceUrl,
  realRepoGitDeps,
  withClonedRepoSource,
  type RepoGitDeps,
} from './repo-source.js'

export const PublishFromRepoSchema = PublishItemSchema.extend({
  repo: RepoSourceSchema,
})

export type PublishFromRepoInput = z.infer<typeof PublishFromRepoSchema>

export interface PublishFromRepoResult {
  readonly itemId: string
  readonly version: string
  /** The full commit sha the ref resolved to — what was actually published. */
  readonly resolvedSha: string
  /** The credit-line origin recorded on the item. */
  readonly sourceUrl: string
  readonly bytes: number
}

export async function publishCatalogItemFromRepo(
  db: CloudDatabase,
  artifactStore: ArtifactStore,
  input: PublishFromRepoInput,
  signer?: ArtifactSigner,
  // Test seam: fixture repos are local paths, which the URL wall (correctly)
  // refuses — tests wrap the real git functions and swap the URL for the
  // fixture path. Production always runs the real deps.
  deps: RepoGitDeps = realRepoGitDeps,
): Promise<PublishFromRepoResult> {
  assertGithubRepoUrl(input.repo.url)

  // Fail before touching the network: a version conflict needs no clone.
  const existing = await findItemVersion(db, {
    itemId: input.item.itemId,
    version: input.version.version,
  })
  if (existing !== null) {
    throw new ConflictError(
      `${input.item.itemId}@${input.version.version} is already published — bump the version.`,
    )
  }

  return withClonedRepoSource(input.repo, deps, async (clone) => {
    const artifactBytes = await packItemFolder(clone.folder, input.item.kind)
    const sourceUrl =
      input.item.sourceUrl ?? deriveRepoSourceUrl(input.repo.url, clone.resolvedSha, clone.subpath)
    const published = await publishCatalogArtifact(
      db,
      artifactStore,
      {
        publisher: input.publisher,
        item: { ...input.item, sourceUrl },
        version: input.version,
        artifactBytes,
      },
      signer,
    )
    return {
      itemId: published.itemId,
      version: published.version,
      resolvedSha: clone.resolvedSha,
      sourceUrl,
      bytes: artifactBytes.length,
    }
  })
}
