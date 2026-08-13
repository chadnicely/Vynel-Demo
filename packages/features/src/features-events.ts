// Outbox event type constants + payload interfaces for the `features` domain
// — `feature.created`, `feature.updated`, `feature.completed`,
// `feature.deleted`.
//
// Each event row is co-committed in the same sync
// `withTransaction(db, (tx) => …)` block as the state change via the
// `_shared/outbox` infra (architecture invariant: every state change
// co-commits its outbox event in ONE transaction). Mirrors phases'
// `phases-events.ts`.
//
// A status change TO 'done' emits `feature.completed` (not
// `feature.updated`); every other patch emits `feature.updated`.
//
// Phase 1 consumers: NONE. Publish-from-day-one anyway so future subscribers
// need no producer-side migration. Payloads are loose-ref FACTS only.

import type { FeatureStatus } from './repositories/index.js'

export const FEATURE_CREATED = 'feature.created' as const
export const FEATURE_UPDATED = 'feature.updated' as const
export const FEATURE_COMPLETED = 'feature.completed' as const
export const FEATURE_DELETED = 'feature.deleted' as const

export type FeatureCreatedPayload = {
  featureId: string
  userId: string
  workspaceId: string
  phaseId: string | null
  createdAt: string
}

export type FeatureUpdatedPayload = {
  featureId: string
  userId: string
  workspaceId: string
  phaseId: string | null
  status: FeatureStatus
  updatedAt: string
}

export type FeatureCompletedPayload = {
  featureId: string
  userId: string
  workspaceId: string
  completedAt: string
}

export type FeatureDeletedPayload = {
  featureId: string
  userId: string
  workspaceId: string
  deletedAt: string
}
