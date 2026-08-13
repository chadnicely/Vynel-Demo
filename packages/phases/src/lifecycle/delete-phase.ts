// Core op — remove a phase (owner-scoped). Hard delete: a phase row is
// re-creatable plan content, and the agent's delete tool cards in ask mode
// (DELETE-route tier). Features that carried this phase's loose `phaseId`
// ref keep it dangling harmlessly — no cascade by design (sibling leaves,
// no FK). Delete + `phase.deleted` co-commit in ONE transaction.

import { randomUUID } from 'node:crypto'
import { withTransaction } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { NotFoundError } from '@vynel/errors'
import * as phasesRepository from '../repositories/index.js'
import { PHASE_DELETED, type PhaseDeletedPayload } from '../phases-events.js'
import type { Database } from '@vynel/db'
import type { StructuralLogger } from '../phases-types.js'

export function deletePhase(
  db: Database,
  input: { phaseId: string; userId: string },
  deps: { logger?: StructuralLogger } = {},
): void {
  const phase = phasesRepository.findPhaseById(db, input.phaseId)
  // Not-found and not-owned are deliberately the same 404 (no existence probe).
  if (!phase || phase.userId !== input.userId) {
    throw new NotFoundError('phase', input.phaseId)
  }

  const now = new Date()
  withTransaction(db, (tx) => {
    phasesRepository.hardDeletePhase(tx, phase.id)
    const payload: PhaseDeletedPayload = {
      phaseId: phase.id,
      userId: phase.userId,
      workspaceId: phase.workspaceId,
      deletedAt: now.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: PHASE_DELETED,
      payload,
      createdAt: now,
      processedAt: null,
    })
  })

  deps.logger?.info({ phaseId: phase.id }, 'phase deleted')
}
