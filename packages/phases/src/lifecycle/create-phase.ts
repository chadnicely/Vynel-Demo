// Core op — append a phase to the workspace's engineering build plan (the
// assistant via its MCP tools). sync. The order index is computed INSIDE the
// transaction (max + 1) so concurrent creates can't collide; insert +
// `phase.created` co-commit in ONE transaction.

import { randomUUID } from 'node:crypto'
import { withTransaction } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { ValidationError } from '@vynel/errors'
import * as phasesRepository from '../repositories/index.js'
import { PHASE_CREATED, type PhaseCreatedPayload } from '../phases-events.js'
import type { Database } from '@vynel/db'
import type { Phase } from '../repositories/index.js'
import type { StructuralLogger } from '../phases-types.js'

export const PHASE_TITLE_MAX_LENGTH = 200
// The big-form body — a phase carries the full build write-up, not a
// one-liner. Far above plans' detail cap by design.
export const PHASE_DESCRIPTION_MAX_LENGTH = 50_000

// Shared field validation (create + update): trimmed, present, capped.
export function validatePhaseTitle(title: string): string {
  const trimmed = title.trim()
  if (trimmed.length === 0) {
    throw new ValidationError('A phase needs a title. Add a short label for the build stage.')
  }
  if (trimmed.length > PHASE_TITLE_MAX_LENGTH) {
    throw new ValidationError(
      `Phase titles are capped at ${PHASE_TITLE_MAX_LENGTH} characters. Put the rest in the description.`,
    )
  }
  return trimmed
}

export function validatePhaseDescription(description: string): string {
  const trimmed = description.trim()
  if (trimmed.length === 0) {
    throw new ValidationError(
      'A phase needs a description — the full write-up of what this build stage covers.',
    )
  }
  if (trimmed.length > PHASE_DESCRIPTION_MAX_LENGTH) {
    throw new ValidationError(
      `Phase descriptions are capped at ${PHASE_DESCRIPTION_MAX_LENGTH} characters.`,
    )
  }
  return trimmed
}

export interface CreatePhaseInput {
  userId: string
  workspaceId: string
  title: string
  description: string
  sessionId?: string // the chat session whose turn created the phase
}

export function createPhase(
  db: Database,
  input: CreatePhaseInput,
  deps: { logger?: StructuralLogger } = {},
): Phase {
  const title = validatePhaseTitle(input.title)
  const description = validatePhaseDescription(input.description)

  const now = new Date()
  const phase = withTransaction(db, (tx) => {
    const maxOrderIndex = phasesRepository.findMaxOrderIndexForWorkspace(tx, input.workspaceId)
    const inserted = phasesRepository.insertPhase(tx, {
      id: randomUUID(),
      userId: input.userId,
      workspaceId: input.workspaceId,
      title,
      description,
      orderIndex: (maxOrderIndex ?? -1) + 1,
      status: 'open',
      sessionId: input.sessionId ?? null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    const payload: PhaseCreatedPayload = {
      phaseId: inserted.id,
      userId: inserted.userId,
      workspaceId: inserted.workspaceId,
      orderIndex: inserted.orderIndex,
      createdAt: now.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: PHASE_CREATED,
      payload,
      createdAt: now,
      processedAt: null,
    })
    return inserted
  })

  deps.logger?.info({ phaseId: phase.id, orderIndex: phase.orderIndex }, 'phase created')
  return phase
}
