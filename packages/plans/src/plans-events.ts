// Outbox event type constants + payload interfaces for the `plans` domain —
// `plan.created`, `plan.updated`, `plan.completed`, `plan.deleted`.
//
// Each event row is co-committed in the same sync
// `withTransaction(db, (tx) => …)` block as the state change via the
// `_shared/outbox` infra (architecture invariant: every state change
// co-commits its outbox event in ONE transaction). Mirrors tasks'
// `tasks-events.ts`.
//
// A status change TO 'done' emits `plan.completed` (not `plan.updated`) —
// completion is the event future subscribers (activity feed, digests) care
// about; every other patch emits `plan.updated`.
//
// Phase 1 consumers: NONE. Publish-from-day-one anyway so future subscribers
// need no producer-side migration. Payloads are loose-ref FACTS only.

import type { PlanSource, PlanStatus } from './repositories/index.js'

export const PLAN_CREATED = 'plan.created' as const
export const PLAN_UPDATED = 'plan.updated' as const
export const PLAN_COMPLETED = 'plan.completed' as const
export const PLAN_DELETED = 'plan.deleted' as const

export type PlanCreatedPayload = {
  planId: string
  userId: string
  workspaceId: string | null // null = GLOBAL scope (no workspace)
  planDate: string
  source: PlanSource
  createdAt: string
}

export type PlanUpdatedPayload = {
  planId: string
  userId: string
  workspaceId: string | null
  planDate: string
  status: PlanStatus
  updatedAt: string
}

export type PlanCompletedPayload = {
  planId: string
  userId: string
  workspaceId: string | null
  planDate: string
  completedAt: string
}

export type PlanDeletedPayload = {
  planId: string
  userId: string
  workspaceId: string | null
  deletedAt: string
}
