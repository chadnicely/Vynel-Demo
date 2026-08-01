// The `plugin` kind's install/uninstall — the delegate kind: Claude Code's
// own plugin system pulls from the publisher's marketplace repo (no
// artifact download, no Vynel DB row; the registry key is the identity).
// Split from `item-lifecycle.ts` when the per-kind branches pushed it past
// the file-size ceiling — the shared surface gate and dispatch stay there;
// this file owns only the plugin bodies.

import type { Logger } from 'pino'
import type { Database } from '@vynel/db'
import { ValidationError } from '@vynel/errors'
import { findCachedCloudItem } from '@vynel/marketplace'
import { parsePluginItemManifest } from '@vynel/contracts/marketplace/plugin-item-manifest'
import type { MarketplacePluginDelegate } from '../../services/marketplace-plugin-delegate.js'

export type InstallPluginItemInput = {
  itemId: string
  pluginKey: string | undefined
}

// No scope choice: plugins are user-scope global (their forced
// `recommendedScope: 'user'` keeps them off the workspace surface).
export async function installPluginItem(
  deps: { db: Database; logger: Logger; pluginDelegate: MarketplacePluginDelegate },
  input: InstallPluginItemInput,
) {
  const { itemId } = input
  const cached = findCachedCloudItem(deps.db, itemId)
  const manifest = parsePluginItemManifest(cached?.latestVersionManifestJson ?? null)
  if (manifest === null) {
    throw new ValidationError('This plugin item carries no install descriptor — re-sync the catalog.')
  }
  await deps.pluginDelegate.install(manifest)
  deps.logger.info({ itemId, pluginKey: input.pluginKey }, 'marketplace plugin installed')
  return {
    kind: 'plugin' as const,
    pluginKey: `${manifest.pluginName}@${manifest.marketplaceName}`,
    itemId,
    version: cached?.latestVersion ?? null,
  }
}

export type UpdatePluginItemInput = {
  itemId: string
  // installedId IS the registry key (`name@marketplace`).
  installedKey: string
}

// In-place update via the delegate (`claude plugin update`) — previously
// uninstall+reinstall. The response version is a REGISTRY RE-READ, not the
// catalog's number: Claude Code pulled whatever the publisher's marketplace
// currently ships, and the card must reflect that truth.
export async function updatePluginItem(
  deps: {
    logger: Logger
    pluginDelegate: MarketplacePluginDelegate
    listInstalledPlugins: () => Array<{ key: string; version: string | null }>
  },
  input: UpdatePluginItemInput,
) {
  const { itemId, installedKey } = input
  const split = splitPluginKey(installedKey)
  await deps.pluginDelegate.update(split)
  const version =
    deps.listInstalledPlugins().find((plugin) => plugin.key === installedKey)?.version ?? null
  deps.logger.info({ itemId, pluginKey: installedKey, version }, 'marketplace plugin updated')
  return { kind: 'plugin' as const, pluginKey: installedKey, itemId, version }
}

export type UninstallPluginItemInput = {
  itemId: string
  // installedId IS the registry key (`name@marketplace`).
  installedKey: string
}

export async function uninstallPluginItem(
  deps: { logger: Logger; pluginDelegate: MarketplacePluginDelegate },
  input: UninstallPluginItemInput,
) {
  const { itemId, installedKey } = input
  await deps.pluginDelegate.uninstall(splitPluginKey(installedKey))
  deps.logger.info({ itemId, pluginKey: installedKey }, 'marketplace plugin uninstalled')
  return { kind: 'plugin' as const, pluginKey: installedKey, itemId }
}

// Plugin names never contain '@', so the FIRST '@' is the split (same rule
// as the provider's registry reader). The guard mirrors the reader's: a
// malformed key must never drive the CLI with a garbage split.
function splitPluginKey(installedKey: string): { pluginName: string; marketplaceName: string } {
  const atIndex = installedKey.indexOf('@')
  if (atIndex <= 0 || atIndex === installedKey.length - 1) {
    throw new ValidationError(`Installed plugin key '${installedKey}' is malformed — cannot proceed.`)
  }
  return {
    pluginName: installedKey.slice(0, atIndex),
    marketplaceName: installedKey.slice(atIndex + 1),
  }
}
