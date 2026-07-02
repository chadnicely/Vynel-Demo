// The public surface of `@vynel/providers`: the `AiAgentProvider` abstract
// class, every shared type, and the registry functions. The concrete
// `ClaudeAiAgentProvider` and the `claude/internal/*` helpers are NOT exported
// — consumers reach a provider only through `resolveAiAgentProvider`.
// See `docs/blueprints/providers/blueprint.md §16` step 18.

export * from './shared/index.js'
export * from './registry.js'
