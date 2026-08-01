// The server-side half of the claude-official publish pipeline: clone the
// pinned anthropics/skills snapshot, zip each allowlisted folder faithfully
// (SKILL.md at the zip root, licenses ride along), and publish it through
// `publishCatalogArtifact` — the one home for "a new catalog version
// exists". Drives the admin portal's "Import Anthropic items" button; the
// operator CLI (`pnpm cloud:import-anthropic`) keeps its local-reviewed-
// checkout flow but shares `packItemFolder` (pack-item-folder.ts). Git runs
// through the shared hardened home (git-fetch.ts).
//
// Idempotent by design: already-published versions are skipped (never
// re-zipped, never overwritten) — a double-click on the button is a no-op
// that doesn't even clone.

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { ConflictError, ValidationError } from '@vynel/errors'
import type { CloudDatabase } from '@vynel/cloud-db'
import type { ArtifactStore } from './artifact-store.js'
import type { ArtifactSigner } from './artifact-signer.js'
import { publishCatalogArtifact } from './publish-catalog-artifact.js'
import { findItemVersion } from './repositories/catalog-repository.js'
import { cloneRepoAtPin } from './git-fetch.js'
import { packItemFolder } from './pack-item-folder.js'
import { KEBAB, SEMVER } from './publish-input.js'

// The shape of `scripts/anthropic-catalog/manifest.json`. Parsed here at the
// boundary: the file arrives from disk, and its values reach git argv and
// filesystem paths — the sha regex and kebab item ids are the injection
// guards (upstream-watch.ts precedent). `repo` may be a URL or a local path
// (tests use fixture repos).
export const AnthropicImportManifestSchema = z.object({
  upstream: z.object({
    repo: z.string().min(1),
    pinnedSha: z.string().regex(/^[0-9a-f]{40}$/, 'must be a full lowercase commit sha'),
  }),
  publisher: z.object({
    id: z.string().regex(KEBAB).max(80),
    name: z.string().min(1).max(120),
    tier: z.enum(['verified', 'anthropic-official', 'community']),
    url: z.string().min(1).max(400),
  }),
  items: z
    .array(
      z.object({
        itemId: z.string().regex(KEBAB).max(120),
        displayName: z.string().min(1).max(120),
        oneLineDescription: z.string().min(1).max(280),
        category: z.string().min(1).max(60),
        iconName: z.string().min(1).max(60),
        recommendedScope: z.enum(['user', 'workspace', 'both']),
        version: z.string().regex(SEMVER).max(40),
      }),
    )
    .min(1),
})

export type AnthropicImportManifest = z.infer<typeof AnthropicImportManifestSchema>

export type AnthropicImportItemResult = {
  itemId: string
  version: string
  outcome: 'published' | 'skipped-already-published'
  /** Artifact size for a publish; null when skipped (nothing was zipped). */
  bytes: number | null
}

export async function importAnthropicItems(
  db: CloudDatabase,
  artifactStore: ArtifactStore,
  manifest: unknown,
  signer?: ArtifactSigner,
): Promise<{ items: AnthropicImportItemResult[] }> {
  const parsed = AnthropicImportManifestSchema.safeParse(manifest)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ')
    throw new ValidationError(`anthropic-catalog manifest is invalid — ${issues}`)
  }
  const { upstream, publisher, items } = parsed.data

  // Pre-check before touching the network: when every manifest version is
  // already published there is nothing to clone.
  const results: AnthropicImportItemResult[] = []
  const pending: typeof items = []
  for (const item of items) {
    const existing = await findItemVersion(db, { itemId: item.itemId, version: item.version })
    if (existing !== null) {
      results.push({
        itemId: item.itemId,
        version: item.version,
        outcome: 'skipped-already-published',
        bytes: null,
      })
    } else {
      pending.push(item)
    }
  }
  if (pending.length === 0) return { items: results }

  const cloneDir = await mkdtemp(join(tmpdir(), 'vynel-import-anthropic-'))
  try {
    await cloneRepoAtPin(upstream.repo, upstream.pinnedSha, cloneDir)
    for (const item of pending) {
      const artifactBytes = await packItemFolder(join(cloneDir, 'skills', item.itemId), 'skill')
      try {
        await publishCatalogArtifact(db, artifactStore, {
          publisher: {
            id: publisher.id,
            name: publisher.name,
            tier: publisher.tier,
            url: publisher.url,
          },
          item: {
            itemId: item.itemId,
            kind: 'skill',
            displayName: item.displayName,
            oneLineDescription: item.oneLineDescription,
            category: item.category,
            iconName: item.iconName,
            recommendedScope: item.recommendedScope,
            sourceUrl: `${upstream.repo}/tree/${upstream.pinnedSha}/skills/${item.itemId}`,
            minimumTier: 'basic',
            status: 'published',
          },
          version: {
            version: item.version,
            changelog: `imported from anthropics/skills@${upstream.pinnedSha.slice(0, 7)}`,
            manifest: { entry: 'SKILL.md' },
          },
          artifactBytes,
        }, signer)
        results.push({
          itemId: item.itemId,
          version: item.version,
          outcome: 'published',
          bytes: artifactBytes.length,
        })
      } catch (err) {
        // The 409-skip semantic: a concurrent publish of the same version is
        // idempotence working, not a failure.
        if (!(err instanceof ConflictError)) throw err
        results.push({
          itemId: item.itemId,
          version: item.version,
          outcome: 'skipped-already-published',
          bytes: null,
        })
      }
    }
  } finally {
    await rm(cloneDir, { recursive: true, force: true }).catch(() => undefined)
  }

  // Answer in manifest order — the pre-check split interleaved the results.
  const manifestOrder = new Map(items.map((item, index) => [item.itemId, index]))
  results.sort(
    (a, b) => (manifestOrder.get(a.itemId) ?? 0) - (manifestOrder.get(b.itemId) ?? 0),
  )
  return { items: results }
}
