// Soft-deletes a Vynel agent (sets `deletedAt`; the row + its
// `agent_skills` survive until the retention purge). Ownership is
// enforced by the `userId` filter; a miss (not found / not owned /
// already deleted) → `NotFoundError`. Spec: `docs/agent-base/agents.md`.

import type { Database } from '@vynel/db'
import { NotFoundError } from '@vynel/errors'
import * as agentsRepository from '@vynel/db/repositories/agents'
import type { StructuralLogger } from './agents-types.js'

export type SoftDeleteAgentInput = {
  agentId: string
  userId: string
}

export async function softDeleteAgent(
  db: Database,
  input: SoftDeleteAgentInput,
  deps: { logger?: StructuralLogger } = {},
): Promise<void> {
  const deleted = agentsRepository.softDeleteAgent(db, input.agentId, input.userId)
  if (!deleted) {
    throw new NotFoundError('agent', input.agentId)
  }
  deps.logger?.info({ agentId: input.agentId }, 'agent soft-deleted')
}
