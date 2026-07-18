// Resolves the agents that should be registered for a session into the
// SDK's `Record<string, AgentDefinition>` shape (keyed by slug) — the
// value passed to `query({ agents })`. THIS unit builds + tests the
// resolver; wiring it into the live chat session is the `orchestration`
// piece (out of scope here). Spec: `docs/agent-base/agents.md`.
//
// Collision rule: a workspace-scope agent OVERRIDES a user-scope agent
// with the same slug (more-specific scope wins) — so a workspace can
// specialize a globally-available agent. We build user-scope entries
// first, then let workspace-scope entries overwrite by slug.
//
// `userId` is part of the input (not just `workspaceId`) because every
// read is tenant-scoped — a missing `userId` filter is review-blocking
// (data-standard "Tenant isolation").

import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk'
import type { Database } from '@vynel/db'
import * as agentsRepository from '@vynel/db/repositories/agents'
import { mapAgentToDefinition } from '../internal/map-agent-to-definition.js'

export type ResolveEnabledAgentsForSessionInput = {
  userId: string
  // null = a GLOBAL session — user-scope agents only (there is no workspace
  // to union in); mirrors the kernel repo's null convention.
  workspaceId: string | null
}

export async function resolveEnabledAgentsForSession(
  db: Database,
  input: ResolveEnabledAgentsForSessionInput,
): Promise<Record<string, AgentDefinition>> {
  const enabledAgents = agentsRepository.listEnabledAgentsForUserAndWorkspace(db, input)

  // Batch the preloaded-skill lookup — one query for all enabled agents
  // rather than N (this runs on every session start). The Map has an entry
  // for every agent id.
  const skillIdsByAgentId = agentsRepository.listSkillIdsForAgents(
    db,
    enabledAgents.map((agent) => agent.id),
  )

  // User-scope first, then workspace-scope overwrites on slug collision.
  const userScope = enabledAgents.filter((agent) => agent.workspaceId === null)
  const workspaceScope = enabledAgents.filter((agent) => agent.workspaceId !== null)

  const definitionsBySlug: Record<string, AgentDefinition> = {}
  for (const agent of [...userScope, ...workspaceScope]) {
    const skillIds = skillIdsByAgentId.get(agent.id) ?? []
    definitionsBySlug[agent.slug] = mapAgentToDefinition(agent, skillIds)
  }
  return definitionsBySlug
}
