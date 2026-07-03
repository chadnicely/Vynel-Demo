// Domain-only types for the `orchestration` core layer — how the root
// brain invokes + coordinates agents. Spec: `docs/agent-base/
// orchestration.md`.
//
// `StructuralLogger` is owned by `@vynel/logger` (type-only — pino's
// runtime never reaches the core layer), matching the skills/agents
// precedent.

export type { StructuralLogger } from '@vynel/logger'

/** A resolved `@mention` — an agent the user named in a turn. */
export type AgentMention = {
  slug: string
  agentId: string
  name: string
}
