// Soft-deletes a Vynel agent (sets `deletedAt`; the row + its
// `agent_skills` survive until the retention purge). Ownership is
// enforced by the `userId` filter; a miss (not found / not owned /
// already deleted) → `NotFoundError`. Spec: `docs/agent-base/agents.md`.

import { randomUUID } from 'node:crypto'
import { withTransaction, type Database } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { NotFoundError } from '@vynel/errors'
import * as agentsRepository from '@vynel/db/repositories/agents'
import type { StructuralLogger } from '../agents-types.js'
import { AGENT_DELETED, type AgentDeletedPayload } from '../agents-events.js'

export type SoftDeleteAgentInput = {
  agentId: string
  userId: string
}

export async function softDeleteAgent(
  db: Database,
  input: SoftDeleteAgentInput,
  deps: { logger?: StructuralLogger } = {},
): Promise<void> {
  // SYNC tx — the `deletedAt` flip + outbox event co-commit. A miss
  // (not found / not owned / already deleted) throws before anything
  // is written, so the transaction has nothing to roll back.
  withTransaction(db, (tx) => {
    const deleted = agentsRepository.softDeleteAgent(tx, input.agentId, input.userId)
    if (!deleted) {
      throw new NotFoundError('agent', input.agentId)
    }

    const payload: AgentDeletedPayload = {
      agentId: deleted.id,
      userId: deleted.userId,
      workspaceId: deleted.workspaceId,
      slug: deleted.slug,
      scope: deleted.scope,
      deletedAt: deleted.updatedAt.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: AGENT_DELETED,
      payload,
      createdAt: deleted.updatedAt,
      processedAt: null,
    })
  })

  deps.logger?.info({ agentId: input.agentId }, 'agent soft-deleted')
}
