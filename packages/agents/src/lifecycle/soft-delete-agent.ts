// Soft-deletes a Vynel agent (sets `deletedAt`; the row + its
// `agent_skills` survive until the retention purge). Ownership is
// enforced by the `userId` filter; a miss (not found / not owned /
// already deleted) → `NotFoundError`. Spec: `docs/agent-base/agents.md`.
//
// Marketplace-sourced agents (source `community`/`vynel`) also drop
// their disk transparency mirror (`.claude/agents/<slug>.md`) after the
// tx commits — best-effort + marker-checked (the row is truth; a
// hand-authored file is never destroyed). User-built agents never had a
// mirror, so `source: 'user'` skips the disk entirely.

import { randomUUID } from 'node:crypto'
import { withTransaction, type Database } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { NotFoundError } from '@vynel/errors'
import * as agentsRepository from '@vynel/db/repositories/agents'
import type { StructuralLogger } from '../agents-types.js'
import { removeAgentMirrorOnDisk } from '../internal/agent-mirror-on-disk.js'
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
  const deleted = withTransaction(db, (tx) => {
    const row = agentsRepository.softDeleteAgent(tx, input.agentId, input.userId)
    if (!row) {
      throw new NotFoundError('agent', input.agentId)
    }

    const payload: AgentDeletedPayload = {
      agentId: row.id,
      userId: row.userId,
      workspaceId: row.workspaceId,
      slug: row.slug,
      scope: row.scope,
      deletedAt: row.updatedAt.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: AGENT_DELETED,
      payload,
      createdAt: row.updatedAt,
      processedAt: null,
    })

    return row
  })

  // Mirror removal AFTER the commit: the row's state must win even if
  // the disk misbehaves (removal is best-effort + marker-checked).
  await removeAgentMirrorOnDisk(
    db,
    { scope: deleted.scope, workspaceId: deleted.workspaceId, slug: deleted.slug },
    deps.logger,
  )

  deps.logger?.info({ agentId: input.agentId }, 'agent soft-deleted')
}
