// Slug lookup for a Vynel agent within an EXACT scope (user-scope when
// `workspaceId` is null; the named workspace otherwise). The
// `@mention`-style "prefer workspace-scope, fall back to user-scope"
// resolution is an `orchestration` concern — this is the precise
// scoped lookup it builds on. Spec: `docs/agent-base/agents.md`.
//
// `find*` returns null when absent; `get*OrThrow` throws
// `NotFoundError` — the paired find/get convention from
// `.claude/rules/naming-reference.md`.

import type { Database } from '@vynel/db'
import { NotFoundError } from '@vynel/errors'
import * as agentsRepository from '@vynel/db/repositories/agents'
import type { AgentRow } from '@vynel/db/repositories/agents'

export type FindAgentBySlugInput = {
  userId: string
  // null = user-scope; non-null = workspace-scope.
  workspaceId: string | null
  slug: string
}

export async function findAgentBySlug(
  db: Database,
  input: FindAgentBySlugInput,
): Promise<AgentRow | null> {
  return agentsRepository.findAgentBySlug(db, input)
}

export async function getAgentBySlugOrThrow(
  db: Database,
  input: FindAgentBySlugInput,
): Promise<AgentRow> {
  const agent = await findAgentBySlug(db, input)
  if (!agent) {
    throw new NotFoundError('agent', input.slug)
  }
  return agent
}
