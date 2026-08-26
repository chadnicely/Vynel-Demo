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

export { AGENT_CREATED, AGENT_UPDATED, AGENT_DELETED } from './agents-events.js'

export type {
  AgentCreatedPayload,
  AgentUpdatedPayload,
  AgentDeletedPayload,
} from './agents-events.js'

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
export {
  installCloudAgent,
  type InstallCloudAgentInput,
} from './lifecycle/install-cloud-agent.js'
// The HAND-AUTHORED agent files (`.claude/agents/*.md` Vynel did not write)
// — live in every session, listed beside the rows, edited as raw files.
export {
  listFileAgentsForScope,
  readFileAgentForScope,
  type FileAgentForScope,
} from './files/list-file-agents-for-scope.js'
export {
  writeFileAgentForScope,
  MAX_AGENT_FILE_LENGTH,
  type WriteFileAgentForScopeInput,
} from './files/write-file-agent-for-scope.js'
export {
  deleteFileAgentForScope,
  type DeleteFileAgentForScopeInput,
} from './files/delete-file-agent-for-scope.js'
export { parseAgentFile, type AgentFileParts } from './files/agent-file-frontmatter.js'
