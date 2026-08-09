// The admin-hub half of marketplace aggregation (marketplace-sources Move
// B): inspect a Claude-native plugin marketplace repo (the review queue's
// material — stateless, nothing stored) and publish the plugins the admin
// approved as `plugin` catalog items with delegate-descriptor manifests
// (the document-skills shape: install delegates to Claude Code's own
// plugin system, which pulls from the publisher's marketplace — Vynel
// never hosts their bytes). Pinned-SHA discipline throughout: the admin
// reviews a snapshot; upstream movement lands only through re-inspection.
//
// Everything in marketplace.json is hostile-until-reviewed: inspection
// TRUNCATES fields to the publish schema's bounds (the review material is
// publishable by construction), dedupes plugin names, and caps the listed
// entries; import re-validates EVERY item with the real PublishItemSchema
// and folds failures into per-item outcomes — one bad plugin never aborts
// the batch. The publisher id is NAMESPACED (`mkt-…`) so a marketplace
// name can never fold onto an existing curated publisher and rewrite it
// (the "Anthropic"-impersonation demotion the review caught).

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import JSZip from 'jszip'
import { ConflictError, NotFoundError, ValidationError } from '@vynel/errors'
import type { CloudDatabase } from '@vynel/cloud-db'
import {
  assertGithubRepoUrl,
  deriveRepoSourceUrl,
  realRepoGitDeps,
  withClonedRepoSource,
  type RepoGitDeps,
} from './repo-source.js'
import { publishCatalogArtifact } from './publish-catalog-artifact.js'
import { PublishItemSchema, type PublishItemInput } from './publish-input.js'
import { listExistingCatalogItemIds } from './repositories/catalog-repository.js'
import type { ArtifactStore } from './artifact-store.js'
import type { ArtifactSigner } from './artifact-signer.js'

export type ClaudeMarketplacePluginInspection = {
  pluginName: string
  description: string | null
  version: string | null
  category: string | null
  /** The catalog item id the import would publish under. */
  proposedItemId: string
  alreadyPublished: boolean
}

export type ClaudeMarketplaceInspection = {
  repoUrl: string
  pinnedSha: string
  marketplaceName: string
  ownerName: string | null
  description: string | null
  plugins: ClaudeMarketplacePluginInspection[]
}

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
// The import route approves at most 100; listing more review rows than
// could ever be approved just hands a hostile file a stall lever.
const MAX_INSPECTED_PLUGINS = 100

// Marketplace/plugin names come from a third-party marketplace.json — fold
// them into the catalog's kebab id space, deterministically.
function toKebabIdPart(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function proposedPluginItemId(marketplaceName: string, pluginName: string): string | null {
  const composed = `${toKebabIdPart(marketplaceName)}-${toKebabIdPart(pluginName)}`
  return KEBAB.test(composed) && composed.length <= 120 ? composed : null
}

/** Namespaced so a marketplace name can never fold onto an existing curated
 * publisher id (e.g. a repo self-named "Anthropic" → `anthropic`) and
 * rewrite its name/tier/url through the publisher upsert. */
export function marketplacePublisherId(marketplaceName: string): string {
  return `mkt-${toKebabIdPart(marketplaceName)}`.slice(0, 80)
}

// Bounded-or-null: hostile strings truncate to the publish schema's caps;
// blank strings fold to null so `min(1)` invariants hold downstream.
function boundedOrNull(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().slice(0, maxLength)
  return trimmed.length > 0 ? trimmed : null
}

/** Read-only inspection at the repo's current HEAD — the portal's review
 * list. Nothing is stored or published. */
export async function inspectClaudeMarketplaceRepo(
  db: CloudDatabase,
  input: { url: string },
  deps: RepoGitDeps = realRepoGitDeps,
): Promise<ClaudeMarketplaceInspection> {
  assertGithubRepoUrl(input.url)
  return withClonedRepoSource({ url: input.url }, deps, async (clone) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(
        await readFile(join(clone.folder, '.claude-plugin', 'marketplace.json'), 'utf8'),
      )
    } catch {
      throw new NotFoundError('claude marketplace catalog', '.claude-plugin/marketplace.json')
    }
    const record = asRecord(parsed)
    const marketplaceName = boundedOrNull(record?.name, 120)
    if (record === null || marketplaceName === null || !Array.isArray(record.plugins)) {
      throw new ValidationError(
        'The repository carries no readable marketplace.json (name + plugins are required).',
      )
    }
    const owner = asRecord(record.owner)
    const metadata = asRecord(record.metadata)
    const seenNames = new Set<string>()
    const plugins: Omit<ClaudeMarketplacePluginInspection, 'alreadyPublished'>[] = []
    for (const entry of record.plugins) {
      if (plugins.length >= MAX_INSPECTED_PLUGINS) break
      const plugin = asRecord(entry)
      const pluginName = boundedOrNull(plugin?.name, 120)
      if (pluginName === null || seenNames.has(pluginName)) continue
      const proposedItemId = proposedPluginItemId(marketplaceName, pluginName)
      if (proposedItemId === null) continue
      seenNames.add(pluginName)
      plugins.push({
        pluginName,
        description: boundedOrNull(plugin?.description, 280),
        // metadata.version is a deliberate ADMIN-VISIBLE prefill (the
        // review table shows it before approval) — never a silent default.
        version: boundedOrNull(plugin?.version, 40) ?? boundedOrNull(metadata?.version, 40),
        category: boundedOrNull(plugin?.category, 60),
        proposedItemId,
      })
    }
    const existingIds = await listExistingCatalogItemIds(
      db,
      plugins.map((plugin) => plugin.proposedItemId),
    )
    return {
      repoUrl: input.url,
      pinnedSha: clone.resolvedSha,
      marketplaceName,
      ownerName: boundedOrNull(owner?.name, 120),
      description: boundedOrNull(metadata?.description, 280),
      plugins: plugins.map((plugin) => ({
        ...plugin,
        alreadyPublished: existingIds.has(plugin.proposedItemId),
      })),
    }
  })
}

export type ImportClaudeMarketplaceInput = {
  url: string
  pinnedSha: string
  marketplaceName: string
  ownerName: string | null
  selected: Array<{
    pluginName: string
    description: string | null
    version: string | null
    category: string | null
  }>
}

export type ImportedPluginOutcome = {
  itemId: string
  pluginName: string
  outcome:
    | 'published'
    | 'skipped-already-published'
    | 'invalid-name'
    | 'invalid-metadata'
    | 'failed'
  /** The cause, for 'invalid-metadata'/'failed' rows — bounded, admin-facing. */
  detail: string | null
}

/** Publish the admin-approved plugins as delegate-descriptor `plugin`
 * items. Approval means AVAILABLE, not endorsed: publisher tier is
 * community, so the cards never badge Official. Per-item failures land in
 * the outcomes — one bad plugin never aborts the batch. */
export async function importClaudeMarketplacePlugins(
  db: CloudDatabase,
  artifactStore: ArtifactStore,
  input: ImportClaudeMarketplaceInput,
  signer?: ArtifactSigner,
): Promise<{ items: ImportedPluginOutcome[] }> {
  assertGithubRepoUrl(input.url)
  const items: ImportedPluginOutcome[] = []
  for (const plugin of input.selected) {
    const itemId = proposedPluginItemId(input.marketplaceName, plugin.pluginName)
    if (itemId === null) {
      items.push({ itemId: '', pluginName: plugin.pluginName, outcome: 'invalid-name', detail: null })
      continue
    }
    const manifest = {
      marketplaceRepo: input.url,
      marketplaceName: input.marketplaceName,
      pluginName: plugin.pluginName,
    }
    // The route trusts the ADMIN, not the marketplace: every item passes
    // the real publish schema (semver, field bounds, kebab ids) exactly
    // like the direct-upload path — the invariants every other publish
    // enforces must not be type-only here.
    const candidate: PublishItemInput = {
      publisher: {
        id: marketplacePublisherId(input.marketplaceName),
        name: boundedOrNull(input.ownerName, 120) ?? input.marketplaceName,
        tier: 'community',
        url: input.url,
      },
      item: {
        itemId,
        kind: 'plugin',
        displayName: boundedOrNull(plugin.pluginName, 120) ?? itemId,
        oneLineDescription:
          boundedOrNull(plugin.description, 280) ?? 'A plugin from this marketplace.',
        category: boundedOrNull(plugin.category, 60) ?? 'plugins',
        iconName: 'package',
        recommendedScope: 'user',
        sourceUrl: deriveRepoSourceUrl(input.url, input.pinnedSha, ''),
        minimumTier: 'basic',
        status: 'published',
      },
      version: {
        // A fabricated version resurrects the phantom-Update class on the
        // desktop card — '' fails the schema's SEMVER wall instead, so a
        // version-less selection surfaces as invalid-metadata.
        version: boundedOrNull(plugin.version, 40) ?? '',
        changelog: `imported from ${input.marketplaceName}@${input.pinnedSha.slice(0, 7)}`,
        manifest,
        minAppVersion: null,
      },
    }
    const validated = PublishItemSchema.safeParse(candidate)
    if (!validated.success) {
      items.push({
        itemId,
        pluginName: plugin.pluginName,
        outcome: 'invalid-metadata',
        detail: validated.error.issues[0]?.message?.slice(0, 200) ?? null,
      })
      continue
    }
    // The publish schema requires bytes; the desktop never downloads a
    // plugin artifact — the descriptor doubles as the human-readable
    // record of what installing delegates (the document-skills shape).
    const zip = new JSZip()
    zip.file(
      'delegate-descriptor.json',
      JSON.stringify(
        {
          note:
            'This plugin item installs by delegating to Claude Code’s own plugin ' +
            'system, which pulls from the publisher’s marketplace repo.',
          manifest,
        },
        null,
        2,
      ),
    )
    const artifactBytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    try {
      await publishCatalogArtifact(db, artifactStore, { ...validated.data, artifactBytes }, signer)
      items.push({ itemId, pluginName: plugin.pluginName, outcome: 'published', detail: null })
    } catch (error) {
      if (error instanceof ConflictError) {
        items.push({
          itemId,
          pluginName: plugin.pluginName,
          outcome: 'skipped-already-published',
          detail: null,
        })
        continue
      }
      // Store/DB hiccups stay per-item — earlier publishes are committed
      // and a re-run converges (published rows skip).
      items.push({
        itemId,
        pluginName: plugin.pluginName,
        outcome: 'failed',
        detail: error instanceof Error ? error.message.slice(0, 200) : null,
      })
    }
  }
  return { items }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}
