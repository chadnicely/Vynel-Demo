// Domain-only types for the `agents` core layer. Spec:
// `docs/agent-base/agents.md`.
//
// `StructuralLogger` is owned by `@vynel/logger` (type-only — pino's
// runtime never reaches the core layer). Row + enum types re-export
// from `@vynel/db` for consumer convenience.

export type { StructuralLogger } from '@vynel/logger'

export type {
  AgentRow,
  NewAgentRow,
  AgentScope,
  AgentSource,
  AgentTrustTier,
  AgentEffort,
  AgentPermissionMode,
  AgentSkillRow,
  NewAgentSkillRow,
} from '@vynel/db/repositories/agents'
