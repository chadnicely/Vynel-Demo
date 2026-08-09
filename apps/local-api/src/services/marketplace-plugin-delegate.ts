// The marketplace's plugin-install delegate — the app-layer seam between
// the marketplace routes and the provider's Claude-plugin CLI (Phase B:
// a `plugin` catalog item installs by driving Claude Code's own plugin
// system, never by downloading an artifact). Lives in services/ so
// `factory.ts` (the env type) and the routes can both import it without a
// cycle. Tests inject a fake via `CreateAppOptions.marketplacePluginDelegate`
// so the HTTP stack never runs the real CLI.

import type { PluginItemManifest } from '@vynel/contracts/marketplace/plugin-item-manifest'
import {
  type ClaudePluginInstallScope,
  addClaudeMarketplace,
  installClaudePlugin,
  removeClaudeMarketplace,
  uninstallClaudePlugin,
  updateClaudePlugin,
} from '@vynel/providers'

export type MarketplacePluginDelegate = {
  install(manifest: PluginItemManifest, installScope: ClaudePluginInstallScope): Promise<void>
  uninstall(input: {
    pluginName: string
    marketplaceName: string
    installScope: ClaudePluginInstallScope
  }): Promise<void>
  update(input: {
    pluginName: string
    marketplaceName: string
    installScope: ClaudePluginInstallScope
  }): Promise<void>
  addMarketplace(input: { sourceUrl: string }): Promise<void>
  removeMarketplace(input: { marketplaceName: string }): Promise<void>
}

export const claudePluginDelegate: MarketplacePluginDelegate = {
  install: (manifest, installScope) => installClaudePlugin({ ...manifest, installScope }),
  uninstall: (input) => uninstallClaudePlugin(input),
  update: (input) => updateClaudePlugin(input),
  addMarketplace: (input) => addClaudeMarketplace(input),
  removeMarketplace: (input) => removeClaudeMarketplace(input),
}
