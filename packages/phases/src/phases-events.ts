// Outbox event type constants + payload interfaces for the `phases` domain —
// `phase.created`, `phase.updated`, `phase.completed`, `phase.deleted`.
//
// Each event row is co-committed in the same sync
// `withTransaction(db, (tx) => …)` block as the state change via the
// `_shared/outbox` infra (architecture invariant: every state change
// co-commits its outbox event in ONE transaction). Mirrors plans'
// `plans-events.ts`.
//
// A status change TO 'done' emits `phase.completed` (not `phase.updated`) —
// completion is the event future subscribers care about; every other patch
// emits `phase.updated`.
//
// Phase 1 consumers: NONE. Publish-from-day-one anyway so future subscribers
// need no producer-side migration. Payloads are loose-ref FACTS only.

import type { PhaseStatus } from './repositories/index.js'

export const PHASE_CREATED = 'phase.created' as const
export const PHASE_UPDATED = 'phase.updated' as const
export const PHASE_COMPLETED = 'phase.completed' as const
export const PHASE_DELETED = 'phase.deleted' as const

export type PhaseCreatedPayload = {
  phaseId: string
  userId: string
  workspaceId: string
  orderIndex: number
  createdAt: string
}

export type PhaseUpdatedPayload = {
  phaseId: string
  userId: string
  workspaceId: string
  status: PhaseStatus
  updatedAt: string
}

export type PhaseCompletedPayload = {
  phaseId: string
  userId: string
  workspaceId: string
  completedAt: string
}

export type PhaseDeletedPayload = {
  phaseId: string
  userId: string
  workspaceId: string
  deletedAt: string
}
