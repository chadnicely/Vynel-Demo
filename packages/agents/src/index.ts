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

export { createAgent, type CreateAgentInput } from './lifecycle/create-agent.js'
export { updateAgent, type UpdateAgentInput } from './lifecycle/update-agent.js'
export { softDeleteAgent, type SoftDeleteAgentInput } from './lifecycle/soft-delete-agent.js'
export {
  listAgentsForWorkspace,
  type ListAgentsForWorkspaceInput,
} from './lifecycle/list-agents-for-workspace.js'
export { listAgentSkillIds } from './session/list-agent-skill-ids.js'
export {
  findAgentBySlug,
  getAgentBySlugOrThrow,
  type FindAgentBySlugInput,
} from './lifecycle/find-agent-by-slug.js'
export {
  resolveEnabledAgentsForSession,
  type ResolveEnabledAgentsForSessionInput,
} from './session/resolve-enabled-agents-for-session.js'
export {
  installCuratedAgent,
  type InstallCuratedAgentInput,
} from './lifecycle/install-curated-agent.js'
