// Domain-only types for the `orchestration` core layer — how the root
// brain invokes + coordinates agents. Spec: `docs/agent-base/
// orchestration.md`.
//
// `StructuralLogger` is owned by `@vynel/logger` (type-only — pino's
// runtime never reaches the core layer), matching the skills/agents
// precedent.

export type { StructuralLogger } from '@vynel/logger'

/**
 * The permission mode a routed delegation runs under — the provider permission
 * modes a user-facing session mode can map to (`@vynel/session`'s
 * `toPermissionMode`; `plan-only` is provider-internal and never routed).
 * `bypass` is the user's explicit no-prompts grant (2026-07-30); it inherits
 * onto delegations the turn spawns. Stored on `delegation_jobs.permissionMode`;
 * null = the unattended default (`bypass-with-behavior-gate`: the irreversible
 * floor still cards). Kept as a local literal union — orchestration sits BELOW
 * `@vynel/session`, so it cannot import the mode model from there; drift fails
 * to typecheck where the value meets the provider's
 * `StartChatSessionInput.permissionMode`.
 */
export type DelegationPermissionMode = 'ask' | 'auto' | 'bypass' | 'bypass-with-behavior-gate'

/** A resolved `@mention` — an agent the user named in a turn. */
export type AgentMention = {
  slug: string
  agentId: string
  name: string
}
