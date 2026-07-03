// Public surface of the `agents` domain.

export type {
  StructuralLogger,
  AgentRow,
  NewAgentRow,
  AgentScope,
  AgentSource,
  AgentTrustTier,
  AgentEffort,
  AgentPermissionMode,
  AgentSkillRow,
  NewAgentSkillRow,
} from './agents-types.js'

export { mapAgentToDefinition } from './internal/map-agent-to-definition.js'

export { createAgent, type CreateAgentInput } from './create-agent.js'
export { updateAgent, type UpdateAgentInput } from './update-agent.js'
export { softDeleteAgent, type SoftDeleteAgentInput } from './soft-delete-agent.js'
export {
  listAgentsForWorkspace,
  type ListAgentsForWorkspaceInput,
} from './list-agents-for-workspace.js'
export { listAgentSkillIds } from './list-agent-skill-ids.js'
export {
  findAgentBySlug,
  getAgentBySlugOrThrow,
  type FindAgentBySlugInput,
} from './find-agent-by-slug.js'
export {
  resolveEnabledAgentsForSession,
  type ResolveEnabledAgentsForSessionInput,
} from './resolve-enabled-agents-for-session.js'
export {
  installCuratedAgent,
  type InstallCuratedAgentInput,
} from './install-curated-agent.js'
