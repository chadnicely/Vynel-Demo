// Core op — add a feature to the workspace's catalog (the assistant via its
// MCP tools). sync. Insert + `feature.created` co-commit in ONE transaction.
// `phaseId` is stored as given — a loose ref, deliberately NOT
// existence-checked against the sibling phases leaf (no cross-feature
// import; a wrong id dangles harmlessly, exactly like tasks.planId).

import { randomUUID } from 'node:crypto'
import { withTransaction } from '@vynel/db'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { ValidationError } from '@vynel/errors'
import * as featuresRepository from '../repositories/index.js'
import { FEATURE_CREATED, type FeatureCreatedPayload } from '../features-events.js'
import type { Database } from '@vynel/db'
import type { Feature } from '../repositories/index.js'
import type { StructuralLogger } from '../features-types.js'

export const FEATURE_TITLE_MAX_LENGTH = 200
// The big-form body — a feature carries the full write-up, matching phases.
export const FEATURE_DESCRIPTION_MAX_LENGTH = 50_000

// Shared field validation (create + update): trimmed, present, capped.
export function validateFeatureTitle(title: string): string {
  const trimmed = title.trim()
  if (trimmed.length === 0) {
    throw new ValidationError('A feature needs a title. Add a short label the user recognizes.')
  }
  if (trimmed.length > FEATURE_TITLE_MAX_LENGTH) {
    throw new ValidationError(
      `Feature titles are capped at ${FEATURE_TITLE_MAX_LENGTH} characters. Put the rest in the description.`,
    )
  }
  return trimmed
}

export function validateFeatureDescription(description: string): string {
  const trimmed = description.trim()
  if (trimmed.length === 0) {
    throw new ValidationError(
      'A feature needs a description — the full write-up of what it does and how it behaves.',
    )
  }
  if (trimmed.length > FEATURE_DESCRIPTION_MAX_LENGTH) {
    throw new ValidationError(
      `Feature descriptions are capped at ${FEATURE_DESCRIPTION_MAX_LENGTH} characters.`,
    )
  }
  return trimmed
}

export interface CreateFeatureInput {
  userId: string
  workspaceId: string
  title: string
  description: string
  phaseId?: string // the build-plan phase that delivers this feature
  sessionId?: string // the chat session whose turn created the feature
}

export function createFeature(
  db: Database,
  input: CreateFeatureInput,
  deps: { logger?: StructuralLogger } = {},
): Feature {
  const title = validateFeatureTitle(input.title)
  const description = validateFeatureDescription(input.description)

  const now = new Date()
  const feature = withTransaction(db, (tx) => {
    const inserted = featuresRepository.insertFeature(tx, {
      id: randomUUID(),
      userId: input.userId,
      workspaceId: input.workspaceId,
      title,
      description,
      phaseId: input.phaseId ?? null,
      status: 'open',
      sessionId: input.sessionId ?? null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    const payload: FeatureCreatedPayload = {
      featureId: inserted.id,
      userId: inserted.userId,
      workspaceId: inserted.workspaceId,
      phaseId: inserted.phaseId,
      createdAt: now.toISOString(),
    }
    insertOutboxEvent(tx, {
      id: randomUUID(),
      type: FEATURE_CREATED,
      payload,
      createdAt: now,
      processedAt: null,
    })
    return inserted
  })

  deps.logger?.info({ featureId: feature.id, phaseId: feature.phaseId }, 'feature created')
  return feature
}
