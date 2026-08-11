// Core op — patch a feature (owner-scoped): title, description, status,
// phaseId. sync. Status is the one home for the completion rule: a
// transition TO 'done' stamps `completedAt` and emits `feature.completed`;
// leaving 'done' clears it (reopening); every other patch emits
// `feature.updated`. `phaseId: null` unlinks the feature from its phase.
// Patch + event co-commit in ONE transaction.

import { randomUUID } from 'node:crypto'
import { withTransaction } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { NotFoundError } from '@vynel/errors'
import * as featuresRepository from '../repositories/index.js'
import { validateFeatureTitle, validateFeatureDescription } from './create-feature.js'
import {
  FEATURE_COMPLETED,
  FEATURE_UPDATED,
  type FeatureCompletedPayload,
  type FeatureUpdatedPayload,
} from '../features-events.js'
import type { Database } from '@vynel/db'
import type { Feature, FeatureStatus, NewFeature } from '../repositories/index.js'
import type { StructuralLogger } from '../features-types.js'

export interface UpdateFeatureInput {
  featureId: string
  userId: string
  title?: string
  description?: string
  status?: FeatureStatus
  phaseId?: string | null // null unlinks from the phase
}

export function updateFeature(
  db: Database,
  input: UpdateFeatureInput,
  deps: { logger?: StructuralLogger } = {},
): Feature {
  const feature = featuresRepository.findFeatureById(db, input.featureId)
  // Not-found and not-owned are deliberately the same 404 (no existence probe).
  if (!feature || feature.userId !== input.userId) {
    throw new NotFoundError('feature', input.featureId)
  }

  const now = new Date()
  const patch: Partial<NewFeature> = { updatedAt: now }

  if (input.title !== undefined) patch.title = validateFeatureTitle(input.title)
  if (input.description !== undefined) {
    patch.description = validateFeatureDescription(input.description)
  }
  if (input.phaseId !== undefined) patch.phaseId = input.phaseId

  const isCompleting = input.status === 'done' && feature.status !== 'done'
  if (input.status !== undefined) {
    patch.status = input.status
    if (isCompleting) patch.completedAt = now
    if (input.status !== 'done' && feature.status === 'done') patch.completedAt = null
  }

  const updated = withTransaction(db, (tx) => {
    const row = featuresRepository.updateFeature(tx, input.featureId, patch)
    if (isCompleting) {
      const payload: FeatureCompletedPayload = {
        featureId: row.id,
        userId: row.userId,
        workspaceId: row.workspaceId,
        completedAt: now.toISOString(),
      }
      insertOutboxEvent(tx, {
        id: randomUUID(),
        type: FEATURE_COMPLETED,
        payload,
        createdAt: now,
        processedAt: null,
      })
    } else {
      const payload: FeatureUpdatedPayload = {
        featureId: row.id,
        userId: row.userId,
        workspaceId: row.workspaceId,
        phaseId: row.phaseId,
        status: row.status,
        updatedAt: now.toISOString(),
      }
      insertOutboxEvent(tx, {
        id: randomUUID(),
        type: FEATURE_UPDATED,
        payload,
        createdAt: now,
        processedAt: null,
      })
    }
    return row
  })

  deps.logger?.info({ featureId: updated.id, status: updated.status }, 'feature updated')
  return updated
}
