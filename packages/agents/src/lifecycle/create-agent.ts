// Creates a Vynel agent (the agent row + its preloaded-skill rows) in
// one transaction. The DB row is the source of truth; materialization
// to the provider's disk (`.claude/agents/<slug>.md`) is a later unit.
// Spec: `docs/agent-base/agents.md`.
//
// Scope is derived from `workspaceId` (null = user-scope). Caller
// responsibilities: workspace ownership for workspace-scoped agents is
// verified UPSTREAM (the route's `getWorkspaceById` check) — core
// trusts it, the same contract skills' `installSkill` relies on
// `workspaceScoped`.
//
// Throws `ConflictError` when an agent with the same slug already
// exists at the requested scope.

import { randomUUID } from 'node:crypto'
import { withTransaction, type Database } from '@vynel/db'
import { ConflictError } from '@vynel/errors'
import * as agentsRepository from '@vynel/db/repositories/agents'
import type {
  AgentRow,
  AgentScope,
  AgentSource,
  AgentTrustTier,
  AgentEffort,
  AgentPermissionMode,
} from '@vynel/db/repositories/agents'
import type { StructuralLogger } from '../agents-types.js'

export type CreateAgentInput = {
  userId: string
  // null = user-scope (available in every workspace); non-null =
  // workspace-scope.
  workspaceId: string | null
  slug: string
  name: string
  description: string
  prompt: string
  source: AgentSource
  trustTier: AgentTrustTier
  icon?: string | null
  model?: string | null
  effort?: AgentEffort | null
  permissionMode?: AgentPermissionMode | null
  background?: boolean
  allowedTools?: string[] | null
  disallowedTools?: string[] | null
  enabled?: boolean
  skillIds?: string[]
}

export async function createAgent(
  db: Database,
  input: CreateAgentInput,
  deps: { logger?: StructuralLogger } = {},
): Promise<AgentRow> {
  const scope: AgentScope = input.workspaceId === null ? 'user' : 'workspace'

  // Pre-check duplicate slug at the requested scope (the partial unique
  // index is the hard backstop). Friendlier than the raw constraint
  // error.
  const existing = agentsRepository.findAgentBySlug(db, {
    userId: input.userId,
    workspaceId: input.workspaceId,
    slug: input.slug,
  })
  if (existing) {
    throw new ConflictError(`An agent with slug "${input.slug}" already exists at ${scope} scope.`)
  }

  const now = new Date()
  const agentId = randomUUID()
  const skillIds = [...new Set(input.skillIds ?? [])]

  const created = withTransaction(db, (tx) => {
    const inserted = agentsRepository.insertAgent(tx, {
      id: agentId,
      userId: input.userId,
      workspaceId: input.workspaceId,
      slug: input.slug,
      name: input.name,
      description: input.description,
      icon: input.icon ?? null,
      prompt: input.prompt,
      model: input.model ?? null,
      effort: input.effort ?? null,
      permissionMode: input.permissionMode ?? null,
      background: input.background ?? false,
      allowedTools: input.allowedTools ?? null,
      disallowedTools: input.disallowedTools ?? null,
      scope,
      source: input.source,
      trustTier: input.trustTier,
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })

    for (const skillId of skillIds) {
      agentsRepository.insertAgentSkill(tx, { agentId: inserted.id, skillId })
    }

    return inserted
  })

  deps.logger?.info({ slug: input.slug, scope, agentId: created.id, source: input.source }, 'agent created')
  return created
}
