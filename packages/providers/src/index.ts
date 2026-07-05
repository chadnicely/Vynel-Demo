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
