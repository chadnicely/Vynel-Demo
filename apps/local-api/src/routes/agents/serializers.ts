// Response serializers for the `agents` routes — DB rows → JSON-safe
// shapes (Date → ISO string). API-internal (single consumer = apps/web);
// promote to `@vynel/contracts/agents/*` on the SECOND consumer.
//
// Two shapes: the list returns the base agent (no preloaded-skill
// fetch — keeps the list a single query); single-agent responses add
// `skillIds`. Mirrors skills' `serializeInstalledSkillRow` vs
// `serializeInstalledSkillWithDefinition` split.

import type { z } from 'zod'
import type { AgentRow } from '@vynel/db/repositories/agents'
import type { CuratedAgentDefinition } from '@vynel/contracts/agents/curated-agents/curated-agent-definition'
import { AgentSchema, AgentWithSkillsSchema, CuratedAgentSchema } from './schemas.js'

export type SerializedAgent = z.infer<typeof AgentSchema>

export function serializeAgent(row: AgentRow): SerializedAgent {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    icon: row.icon,
    prompt: row.prompt,
    model: row.model,
    effort: row.effort,
    permissionMode: row.permissionMode,
    background: row.background,
    allowedTools: row.allowedTools,
    disallowedTools: row.disallowedTools,
    scope: row.scope,
    workspaceId: row.workspaceId,
    source: row.source,
    trustTier: row.trustTier,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export type SerializedAgentWithSkills = z.infer<typeof AgentWithSkillsSchema>

export function serializeAgentWithSkills(
  row: AgentRow,
  skillIds: string[],
): SerializedAgentWithSkills {
  return { ...serializeAgent(row), skillIds }
}

// A curated-catalog entry → JSON-safe browse shape. The catalog is the
// compiled-in `CURATED_AGENT_CATALOG`; this is what the Agents panel's
// "browse curated" list renders + installs from. Optional runtime fields
// serialize to `null` when omitted (the entry inherits from the session);
// readonly arrays are spread to plain arrays.
export type SerializedCuratedAgent = z.infer<typeof CuratedAgentSchema>

export function serializeCuratedAgent(
  definition: CuratedAgentDefinition,
): SerializedCuratedAgent {
  return {
    slug: definition.slug,
    name: definition.name,
    description: definition.description,
    iconName: definition.iconName,
    prompt: definition.prompt,
    model: definition.model ?? null,
    effort: definition.effort ?? null,
    permissionMode: definition.permissionMode ?? null,
    background: definition.background,
    allowedTools: definition.allowedTools ? [...definition.allowedTools] : null,
    disallowedTools: definition.disallowedTools ? [...definition.disallowedTools] : null,
    skillIds: [...definition.skillIds],
    recommendedScope: definition.recommendedScope,
  }
}
