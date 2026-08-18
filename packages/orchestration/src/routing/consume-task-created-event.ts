// The `task.created` outbox CONSUMER — the task-execution arc's PICKUP NUDGE
// (docs/module-notes/task-execution.md §3). A task the USER files must reach
// the assistant, not sit on the list until someone happens to look: this
// reacts by enqueueing a report delivery to the scope's primary conversation,
// so the nudge rides the same notify-turn engine as every cross-session
// report — and the claim machinery queues it behind a running turn for free
// (pickup happens naturally at turn end). `tasks` never imports this leaf —
// core's registry is the seam (loose cross-domain contract: the payload shape
// is re-declared here, field-for-field with the producer).
//
// ONLY user-sourced tasks nudge: an assistant-created task means the
// assistant is already tracking that work — nudging it about its own
// bookkeeping would loop every create into a wasted turn.

import { findWorkspaceById } from '@vynel/db/repositories/workspaces'
import { enqueueReportDelivery } from './enqueue-report-delivery.js'
import type { Database } from '@vynel/db'

// Field-for-field the payload `tasks` publishes.
export interface TaskCreatedPayload {
  taskId: string
  userId: string
  workspaceId: string | null // null = GLOBAL scope (no workspace)
  title: string
  source: 'assistant' | 'user'
  createdAt: string // ISO
}

/** Returns the enqueued report-delivery job id, or null when no nudge is due. */
export function consumeTaskCreatedEvent(
  db: Database,
  payload: TaskCreatedPayload,
): string | null {
  if (payload.source !== 'user') return null

  // A deleted workspace degrades to the global root (the monitor-wake
  // precedent) — the nudge still reaches the user's chat somewhere.
  const workspace =
    payload.workspaceId !== null ? findWorkspaceById(db, payload.workspaceId) : null

  return enqueueReportDelivery(db, {
    userId: payload.userId,
    // Loose provenance ref (never a FK) — there is no chat session behind a
    // panel-created task.
    reporterSessionId: `task:${payload.taskId}`,
    reporterLabel: 'Tasks',
    reportBody:
      `The user put a new task on the list: "${payload.title}" (id ${payload.taskId}). ` +
      'If you are not already working a task, pick this one up now: read the task-planner ' +
      'notebook for the discipline, clear up anything ambiguous with the user first ' +
      '(ask_user with this taskId), size the work, then set it in-progress and lay out its ' +
      'steps with set_task_steps. If you are mid-task, finish that first — the list drains ' +
      'one task at a time, in order (list_tasks shows the queue).',
    requester:
      workspace !== null
        ? {
            kind: 'workspace-primary',
            workspaceId: workspace.id,
            workspacePath: workspace.path,
          }
        : { kind: 'global-root' },
  })
}
