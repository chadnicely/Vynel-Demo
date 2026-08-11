// Core op — patch a phase (owner-scoped): title, description, status,
// orderIndex. sync. Status is the one home for the completion rule: a
// transition TO 'done' stamps `completedAt` and emits `phase.completed`;
// leaving 'done' clears it (reopening); every other patch emits
// `phase.updated`. Patch + event co-commit in ONE transaction.

import { randomUUID } from 'node:crypto'
import { withTransaction } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { NotFoundError, ValidationError } from '@vynel/errors'
import * as phasesRepository from '../repositories/index.js'
import { validatePhaseTitle, validatePhaseDescription } from './create-phase.js'
import {
  PHASE_COMPLETED,
  PHASE_UPDATED,
  type PhaseCompletedPayload,
  type PhaseUpdatedPayload,
} from '../phases-events.js'
import type { Database } from '@vynel/db'
import type { NewPhase, Phase, PhaseStatus } from '../repositories/index.js'
import type { StructuralLogger } from '../phases-types.js'

export interface UpdatePhaseInput {
  phaseId: string
  userId: string
  title?: string
  description?: string
  status?: PhaseStatus
  orderIndex?: number
}

export function updatePhase(
  db: Database,
  input: UpdatePhaseInput,
  deps: { logger?: StructuralLogger } = {},
): Phase {
  const phase = phasesRepository.findPhaseById(db, input.phaseId)
  // Not-found and not-owned are deliberately the same 404 (no existence probe).
  if (!phase || phase.userId !== input.userId) {
    throw new NotFoundError('phase', input.phaseId)
  }

  const now = new Date()
  const patch: Partial<NewPhase> = { updatedAt: now }

  if (input.title !== undefined) patch.title = validatePhaseTitle(input.title)
  if (input.description !== undefined) {
    patch.description = validatePhaseDescription(input.description)
  }
  if (input.orderIndex !== undefined) {
    if (!Number.isInteger(input.orderIndex) || input.orderIndex < 0) {
      throw new ValidationError('The phase position must be a whole number, starting at 0.')
    }
    patch.orderIndex = input.orderIndex
  }

  const isCompleting = input.status === 'done' && phase.status !== 'done'
  if (input.status !== undefined) {
    patch.status = input.status
    if (isCompleting) patch.completedAt = now
    if (input.status !== 'done' && phase.status === 'done') patch.completedAt = null
  }

  const updated = withTransaction(db, (tx) => {
    const row = phasesRepository.updatePhase(tx, input.phaseId, patch)
    if (isCompleting) {
      const payload: PhaseCompletedPayload = {
        phaseId: row.id,
        userId: row.userId,
        workspaceId: row.workspaceId,
        completedAt: now.toISOString(),
      }
      insertOutboxEvent(tx, {
        id: randomUUID(),
        type: PHASE_COMPLETED,
        payload,
        createdAt: now,
        processedAt: null,
      })
    } else {
      const payload: PhaseUpdatedPayload = {
        phaseId: row.id,
        userId: row.userId,
        workspaceId: row.workspaceId,
        status: row.status,
        updatedAt: now.toISOString(),
      }
      insertOutboxEvent(tx, {
        id: randomUUID(),
        type: PHASE_UPDATED,
        payload,
        createdAt: now,
        processedAt: null,
      })
    }
    return row
  })

  deps.logger?.info({ phaseId: updated.id, status: updated.status }, 'phase updated')
  return updated
}
