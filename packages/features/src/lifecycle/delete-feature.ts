// Core op — remove a feature (owner-scoped). Hard delete: a feature row is
// re-creatable plan content, and the agent's delete tool cards in ask mode
// (DELETE-route tier). Delete + `feature.deleted` co-commit in ONE
// transaction.

import { randomUUID } from 'node:crypto'
import { withTransaction } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { NotFoundError } from '@vynel/errors'
import * as featuresRepository from '../repositories/index.js'
import { FEATURE_DELETED, type FeatureDeletedPayload } from '../features-events.js'
import type { Database } from '@vynel/db'
import type { StructuralLogger } from '../features-types.js'

export function deleteFeature(
  db: Database,
  input: { featureId: string; userId: string },
  deps: { logger?: StructuralLogger } = {},
): void {
  const feature = featuresRepository.findFeatureById(db, input.featureId)
  // Not-found and not-owned are deliberately the same 404 (no existence probe).
  if (!feature || feature.userId !== input.userId) {
    throw new NotFoundError('feature', input.featureId)
  }

  const now = new Date()
  withTransaction(db, (tx) => {
    featuresRepository.hardDeleteFeature(tx, feature.id)
    const payload: FeatureDeletedPayload = {
      featureId: feature.id,
      userId: feature.userId,
      workspaceId: feature.workspaceId,
      deletedAt: now.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: FEATURE_DELETED,
      payload,
      createdAt: now,
      processedAt: null,
    })
  })

  deps.logger?.info({ featureId: feature.id }, 'feature deleted')
}
