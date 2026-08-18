// The public surface of `@vynel/providers`: the `AiAgentProvider` abstract
// class, every shared type, the registry functions, and the provider-status
// ops (the old core `providers` domain's runtime reads — install/auth status
// + on-disk skills discovery). The concrete `ClaudeAiAgentProvider` and the
// `claude/internal/*` helpers are NOT exported — consumers reach a provider
// only through `resolveAiAgentProvider`.
// See `docs/blueprints/providers/blueprint.md §16` step 18.

export * from './shared/index.js'
export * from './registry.js'
export { listProvidersWithStatus } from './status/list-providers-with-status.js'
export { getProviderAuthenticationStatus } from './status/get-provider-authentication-status.js'
export {
  discoverInstalledSkillsForProvider,
  type DiscoverInstalledSkillsForProviderInput,
} from './status/discover-installed-skills-for-provider.js'
// The plugin-delegate seam (claude-official arc Phase B): drives the SDK's
// bundled `claude` binary so marketplace `plugin` items install into Claude
// Code's native layout. Deliberately Claude-named — a second provider gets
// an agnostic wrapper when it exists (the discover-skills precedent).
export {
  installClaudePlugin,
  uninstallClaudePlugin,
  updateClaudePlugin,
  listInstalledClaudePlugins,
  resolveBundledClaudeBinary,
  type InstallClaudePluginInput,
  type ClaudePluginInstallScope,
  type InstalledClaudePluginView,
} from './claude/installation/claude-plugin-cli.js'
export {
  listMcpOauthCredentialStatuses,
  type McpOauthCredentialStatus,
} from './claude/installation/read-claude-mcp-credentials.js'
export {
  loginClaudeMcpServer,
  logoutClaudeMcpServer,
  type ClaudeMcpAuthInput,
} from './claude/installation/claude-mcp-cli.js'
// The LOCAL Claude sign-in relay (top-bar account popup): drives
// `claude auth login --claudeai` on this machine — URL out, pasted code in,
// never the credential (D14). Claude-named like the plugin delegate above.
export {
  ClaudeLoginRelay,
  type ClaudeLoginPhase,
  type ClaudeLoginProcess,
  type ClaudeLoginRelayDeps,
  type ClaudeLoginState,
} from './claude/installation/claude-login-relay.js'
export {
  addClaudeMarketplace,
  removeClaudeMarketplace,
  listKnownClaudeMarketplaces,
  readClaudeMarketplaceCatalog,
  type KnownClaudeMarketplaceView,
  type ClaudeMarketplaceCatalogView,
  type ClaudeMarketplacePluginView,
} from './claude/installation/claude-marketplace-cli.js'
