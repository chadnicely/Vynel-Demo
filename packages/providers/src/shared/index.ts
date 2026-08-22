// Barrel for `packages/providers/src/shared/` — the `AiAgentProvider` abstract
// class, every shared type that crosses the package boundary, and the two
// in-memory registries. Re-exports only. Per
// `.claude/rules/structure-standard.md` "packages/providers/src/".

export * from './ai-agent-provider.js'
export * from './ai-agent-provider-id.js'
export * from './authentication-status.js'
export * from './installed-skill.js'
export * from './mcp-server-config.js'
export * from './start-chat-session-input.js'
export * from './discover-models-input.js'
export * from './workspace-plan.js'
export * from './normalized-session-event.js'
export * from './approval-decision.js'
export * from './persisted-session-record.js'
export * from './chat-session-transcript.js'
export * from './active-session-registry.js'
export * from './pending-approval-registry.js'
