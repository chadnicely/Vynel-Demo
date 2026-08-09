// Drives the bundled binary's plugin-MARKETPLACE lifecycle and reads its
// disk contract — the seam behind user-added Claude-native marketplaces
// (delegate-to-native: the CLI owns the clone, `known_marketplaces.json`,
// and the settings declaration; Vynel only drives and reads). Probed
// 2026-08-09: the `owner/repo` shorthand needs auth state the daemon may
// not have — callers normalize to the https `.git` URL form, which clones
// bare-git reliably.
//
// Reads are LENIENT (a broken clone or missing file answers empty — the
// shelf must never break on one bad marketplace); the write commands throw
// typed errors like their plugin/mcp siblings.

import os from 'node:os'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { ValidationError } from '@vynel/errors'
import { runPluginCommand } from './claude-plugin-cli.js'

export type KnownClaudeMarketplaceView = {
  marketplaceName: string
  /** The registered origin — a git/https URL, or a github `owner/repo`
   * rendered as its https URL; null when the known-file entry is a local
   * path or an unrecognized shape. */
  sourceUrl: string | null
  installLocation: string | null
  lastUpdated: string | null
}

export type ClaudeMarketplacePluginView = {
  pluginName: string
  description: string | null
  version: string | null
  category: string | null
}

export type ClaudeMarketplaceCatalogView = {
  marketplaceName: string
  ownerName: string | null
  description: string | null
  plugins: ClaudeMarketplacePluginView[]
}

export async function addClaudeMarketplace(input: {
  sourceUrl: string
  binaryPath?: string
}): Promise<void> {
  assertSafeCliArgument(input.sourceUrl, 'marketplace source')
  await runPluginCommand(['marketplace', 'add', input.sourceUrl], input.binaryPath)
}

export async function removeClaudeMarketplace(input: {
  marketplaceName: string
  binaryPath?: string
}): Promise<void> {
  assertSafeCliArgument(input.marketplaceName, 'marketplace name')
  await runPluginCommand(['marketplace', 'remove', input.marketplaceName], input.binaryPath)
}

/** SYNC read of the CLI's marketplace registry — feeds the sources list
 * and the per-marketplace catalog reads. */
export function listKnownClaudeMarketplaces(
  homeDir = os.homedir(),
): KnownClaudeMarketplaceView[] {
  const knownPath = path.join(homeDir, '.claude', 'plugins', 'known_marketplaces.json')
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(knownPath, 'utf8'))
  } catch {
    return []
  }
  if (typeof parsed !== 'object' || parsed === null) return []
  return Object.entries(parsed as Record<string, unknown>).map(([marketplaceName, entry]) => {
    const record = asRecord(entry)
    const source = asRecord(record?.source)
    // Two registration shapes exist in real registries: {source:'git', url}
    // and {source:'github', repo} — both render to a browsable https URL.
    const sourceUrl =
      typeof source?.url === 'string'
        ? source.url
        : typeof source?.repo === 'string'
          ? `https://github.com/${source.repo}`
          : null
    return {
      marketplaceName,
      sourceUrl,
      installLocation: typeof record?.installLocation === 'string' ? record.installLocation : null,
      lastUpdated: typeof record?.lastUpdated === 'string' ? record.lastUpdated : null,
    }
  })
}

/** SYNC read of one registered marketplace's catalog — the clone's
 * `.claude-plugin/marketplace.json`. */
export function readClaudeMarketplaceCatalog(
  marketplaceName: string,
  installLocation: string,
): ClaudeMarketplaceCatalogView | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(
      readFileSync(path.join(installLocation, '.claude-plugin', 'marketplace.json'), 'utf8'),
    )
  } catch {
    return null
  }
  const record = asRecord(parsed)
  if (record === null || !Array.isArray(record.plugins)) return null
  const metadata = asRecord(record.metadata)
  const owner = asRecord(record.owner)
  const plugins: ClaudeMarketplacePluginView[] = []
  for (const entry of record.plugins) {
    const plugin = asRecord(entry)
    if (plugin === null || typeof plugin.name !== 'string' || plugin.name.length === 0) continue
    plugins.push({
      pluginName: plugin.name,
      description: typeof plugin.description === 'string' ? plugin.description : null,
      version:
        typeof plugin.version === 'string'
          ? plugin.version
          : typeof metadata?.version === 'string'
            ? metadata.version
            : null,
      category: typeof plugin.category === 'string' ? plugin.category : null,
    })
  }
  return {
    marketplaceName,
    ownerName: typeof owner?.name === 'string' ? owner.name : null,
    description: typeof metadata?.description === 'string' ? metadata.description : null,
    plugins,
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function assertSafeCliArgument(value: string, label: string): void {
  if (value.trim().length === 0 || value.startsWith('-')) {
    throw new ValidationError(`The ${label} cannot be empty or start with '-'.`)
  }
}
