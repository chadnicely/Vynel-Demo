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
// Consumers: `task.created` drives the PICKUP NUDGE (task-execution arc,
// 2026-08-18) — core's outbox registry routes it to
// `consumeTaskCreatedEvent` (@vynel/orchestration), which re-declares the
// payload field-for-field (the loose cross-domain contract). `title` rides
// the payload so the nudge can name the task without a cross-leaf read (the
// ask.created `firstQuestionLabel` precedent). Other types: consumers NONE
// yet; publish-from-day-one anyway. Payloads are loose-ref FACTS only.

import type { TaskSource, TaskStatus } from './repositories/index.js'

export const TASK_CREATED = 'task.created' as const
export const TASK_UPDATED = 'task.updated' as const
export const TASK_COMPLETED = 'task.completed' as const
export const TASK_DELETED = 'task.deleted' as const

export type TaskCreatedPayload = {
  taskId: string
  userId: string
  workspaceId: string | null // null = GLOBAL scope (no workspace)
  title: string // the nudge names the task the user just filed
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
