// Outbox event type constants + payload interfaces for the `tasks` domain —
// `task.created`, `task.updated`, `task.completed`, `task.deleted`.
//
// Each event row is co-committed in the same sync
// `withTransaction(db, (tx) => …)` block as the state change via the
// `_shared/outbox` infra (architecture invariant: every state change
// co-commits its outbox event in ONE transaction). Mirrors channels'
// `channels-events.ts`.
//
// A status change TO 'done' emits `task.completed` (not `task.updated`) —
// completion is the event future subscribers (activity feed, digests) care
// about; every other patch emits `task.updated`.
//
// Phase 1 consumers: NONE. Publish-from-day-one anyway so future subscribers
// need no producer-side migration. Payloads are loose-ref FACTS only.

import type { TaskSource, TaskStatus } from './repositories/index.js'

export const TASK_CREATED = 'task.created' as const
export const TASK_UPDATED = 'task.updated' as const
export const TASK_COMPLETED = 'task.completed' as const
export const TASK_DELETED = 'task.deleted' as const

export type TaskCreatedPayload = {
  taskId: string
  userId: string
  workspaceId: string | null // null = GLOBAL scope (no workspace)
  source: TaskSource
  createdAt: string
}

export type TaskUpdatedPayload = {
  taskId: string
  userId: string
  workspaceId: string | null
  status: TaskStatus
  updatedAt: string
}

export type TaskCompletedPayload = {
  taskId: string
  userId: string
  workspaceId: string | null
  completedAt: string
}

export type TaskDeletedPayload = {
  taskId: string
  userId: string
  workspaceId: string | null
  deletedAt: string
}
