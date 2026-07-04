// Installs a Vynel-CURATED agent from the compiled-in catalog
// (`CURATED_AGENT_CATALOG`) as an `agents` row — the seed-install path.
// Mirrors `installSkill` (catalog lookup → row): looks up the curated
// definition by slug, stamps `source: 'vynel'` + `trustTier: 'verified'`
// + `enabled: true`, and delegates the actual insert to `createAgent`.
//
// NOTE: this op is an addition beyond the brief's enumerated core ops —
// it is the bridge that makes the curated seed catalog usable + lets the
// resolver test exercise the real catalog end-to-end. Kept thin: it
// adds no behavior of its own beyond catalog → createAgent mapping.
// Spec: `docs/agent-base/agents.md` (curated seed).

import type { Database } from '@vynel/db'
import { NotFoundError } from '@vynel/errors'
import { findCuratedAgentBySlug } from '@vynel/contracts/agents/curated-agents/curated-agent-catalog'
import { createAgent, type CreateAgentInput } from './create-agent.js'
import type { AgentRow, StructuralLogger } from '../agents-types.js'

export type InstallCuratedAgentInput = {
  userId: string
  // null = install at user-scope (available in every workspace).
  workspaceId: string | null
  // The curated catalog slug (e.g. 'document-generator').
  slug: string
}

export async function installCuratedAgent(
  db: Database,
  input: InstallCuratedAgentInput,
  deps: { logger?: StructuralLogger } = {},
): Promise<AgentRow> {
  const definition = findCuratedAgentBySlug(input.slug)
  if (!definition) {
    throw new NotFoundError('curated agent', input.slug)
  }

  const createInput: CreateAgentInput = {
    userId: input.userId,
    workspaceId: input.workspaceId,
    slug: definition.slug,
    name: definition.name,
    description: definition.description,
    prompt: definition.prompt,
    icon: definition.iconName,
    background: definition.background,
    source: 'vynel',
    trustTier: 'verified',
    enabled: true,
    skillIds: [...definition.skillIds],
  }
  // Conditionally carry the optional runtime fields
  // (exactOptionalPropertyTypes — never assign undefined).
  if (definition.model !== undefined) createInput.model = definition.model
  if (definition.effort !== undefined) createInput.effort = definition.effort
  if (definition.permissionMode !== undefined) {
    createInput.permissionMode = definition.permissionMode
  }
  if (definition.allowedTools !== undefined) {
    createInput.allowedTools = [...definition.allowedTools]
  }
  if (definition.disallowedTools !== undefined) {
    createInput.disallowedTools = [...definition.disallowedTools]
  }

  return createAgent(db, createInput, deps)
}
