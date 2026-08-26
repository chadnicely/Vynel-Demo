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
import { TASKS_REPORTER_LABEL } from '@vynel/contracts/chat/engine-reporter-labels'
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
    reporterLabel: TASKS_REPORTER_LABEL,
    // ONE short human-readable line: the row renders on the user's transcript
    // as a quiet system notice, so no tool mechanics here — the standing tasks
    // prompt + the task-planner notebook already carry the full discipline
    // (and the delivered-card title strips markdown control chars, so an
    // underscored tool name would render mangled — the 2026-08-18 smoke).
    reportBody:
      `New task on the list: "${payload.title}" (task id ${payload.taskId}). ` +
      'Pick it up when free — the task-planner notebook has the discipline.',
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
