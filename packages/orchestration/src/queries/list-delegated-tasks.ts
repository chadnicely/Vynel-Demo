// `listDelegatedTasks` / `getDelegatedTask` — what an agent can read back about
// the work it handed off. `send_message` returns `{ status: 'enqueued', jobId }`,
// and until these two reads existed that jobId was a DEAD HANDLE: no tool
// accepted it, so an agent could start delegated work and never learn anything
// about it except by waiting for the report to arrive on its own.
//
// RENAMED from "background runs" (Kafi, 2026-08-17): that phrase reads as an
// OS/shell background process, and there is no such thing here — a delegated
// task is a queue row plus a turn on the target session's own conversation.
//
// Read-only and tenant-scoped. `getDelegatedTask` takes the userId in the same
// call as the id — a job id is guessable enough that resolving it before the
// ownership check would leak another tenant's task text.
//
// STATUS VOCABULARY. The queue's own union (`pending` | `claimed` | ...) is
// storage vocabulary — `claimed` describes the worker's compare-and-swap, which
// says nothing to a model reading its own task list. These map to words that
// mean what they say: queued / running / completed / failed.

import type { Database } from '@vynel/db'
import { deriveDelegationTaskLabel } from '@vynel/contracts/chat/delegation-task-label'
import {
  findDelegationJobById,
  listRecentDelegationJobsForUser,
  type DelegationJob,
  type DelegationJobStatus,
} from '../repositories/index.js'

export type DelegatedTaskStatus = 'queued' | 'running' | 'completed' | 'failed'

const STATUS_BY_JOB_STATUS: Readonly<Record<DelegationJobStatus, DelegatedTaskStatus>> = {
  pending: 'queued',
  claimed: 'running',
  completed: 'completed',
  failed: 'failed',
}

// Long enough to recognize the answer, short enough that a list of tasks can't
// flood the agent's context. The full text is one `getDelegatedTask` away.
const RESULT_PREVIEW_LENGTH = 280

export interface DelegatedTask {
  jobId: string
  status: DelegatedTaskStatus
  /** Where the work went — the workspace's name, or 'Session' for a spawned-session target. */
  target: string
  /** The task as a short human label — the same derivation the liveness indicator uses. */
  taskLabel: string
  /** The delegation's correlation key — the handle that identifies this task's trace. */
  partialSessionId: string | null
  enqueuedAt: string
  finishedAt: string | null
  /** Present once the task finished successfully. Truncated in list reads. */
  resultPreview: string | null
  /** Present when the task failed — why. */
  errorMessage: string | null
}

/** One task, with the FULL result text rather than a preview. */
export interface DelegatedTaskDetail extends Omit<DelegatedTask, 'resultPreview'> {
  /** The complete result the task reported back. Null until it completes. */
  result: string | null
  /** The task exactly as it was handed off (the label is a derived summary). */
  taskText: string
}

function toDelegatedTask(job: DelegationJob): DelegatedTask {
  const result = job.resultText
  return {
    jobId: job.id,
    status: STATUS_BY_JOB_STATUS[job.status],
    target: job.workspaceName ?? 'Session',
    taskLabel: deriveDelegationTaskLabel(job.taskText),
    partialSessionId: job.partialSessionId,
    enqueuedAt: job.createdAt.toISOString(),
    finishedAt: job.completedAt?.toISOString() ?? null,
    resultPreview:
      result === null || result === ''
        ? null
        : result.length > RESULT_PREVIEW_LENGTH
          ? `${result.slice(0, RESULT_PREVIEW_LENGTH)}…`
          : result,
    errorMessage: job.errorMessage,
  }
}

export function listDelegatedTasks(
  db: Database,
  input: { userId: string; limit?: number },
): DelegatedTask[] {
  return listRecentDelegationJobsForUser(db, input.userId, input.limit).map(toDelegatedTask)
}

/** Null when the id is unknown OR owned by another user — the caller maps both
 *  to the same 404, so a probe can't tell "not yours" from "doesn't exist". */
export function getDelegatedTask(
  db: Database,
  input: { userId: string; jobId: string },
): DelegatedTaskDetail | null {
  const job = findDelegationJobById(db, input.jobId)
  if (job === null || job.userId !== input.userId) return null
  // The detail read admits EXACTLY what the list read admits (task rows —
  // `listRecentDelegationJobsForUser`'s NULL/'task' filter): delivery rows are
  // the notify mechanism, agent-run rows are the mention machinery, and a note
  // is plain communication — a detail readable but never listed would let the
  // two reads disagree.
  if (job.jobKind !== null && job.jobKind !== 'task') return null

  const { resultPreview: _preview, ...task } = toDelegatedTask(job)
  return {
    ...task,
    result: job.resultText === '' ? null : job.resultText,
    taskText: job.taskText,
  }
}
