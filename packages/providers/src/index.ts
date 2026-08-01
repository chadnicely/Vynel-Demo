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
  type InstalledClaudePluginView,
} from './claude/installation/claude-plugin-cli.js'
