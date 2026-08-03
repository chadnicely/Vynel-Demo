// `listBackgroundRuns` / `getBackgroundRun` — what an agent can read back about
// the work it handed off. `send_task_to_workspace` and `send_task_to_session`
// return `{ status: 'enqueued', jobId }`, and until these two reads existed that
// jobId was a DEAD HANDLE: no tool accepted it, so an agent could start
// background work and never learn anything about it except by waiting for the
// report to arrive on its own.
//
// Read-only and tenant-scoped. `getBackgroundRun` takes the userId in the same
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

export type BackgroundRunStatus = 'queued' | 'running' | 'completed' | 'failed'

const STATUS_BY_JOB_STATUS: Readonly<Record<DelegationJobStatus, BackgroundRunStatus>> = {
  pending: 'queued',
  claimed: 'running',
  completed: 'completed',
  failed: 'failed',
}

// Long enough to recognize the answer, short enough that a list of runs can't
// flood the agent's context. The full text is one `getBackgroundRun` away.
const RESULT_PREVIEW_LENGTH = 280

export interface BackgroundRun {
  jobId: string
  status: BackgroundRunStatus
  /** Where the work went — the workspace's name, or 'Session' for a spawned-session target. */
  target: string
  /** The task as a short human label — the same derivation the liveness indicator uses. */
  taskLabel: string
  /** The delegation's correlation key — the handle that identifies this run's trace. */
  partialSessionId: string | null
  enqueuedAt: string
  finishedAt: string | null
  /** Present once the run finished successfully. Truncated in list reads. */
  resultPreview: string | null
  /** Present when the run failed — why. */
  errorMessage: string | null
}

/** One run, with the FULL result text rather than a preview. */
export interface BackgroundRunDetail extends Omit<BackgroundRun, 'resultPreview'> {
  /** The complete result the run reported back. Null until it completes. */
  result: string | null
  /** The task exactly as it was handed off (the label is a derived summary). */
  taskText: string
}

function toBackgroundRun(job: DelegationJob): BackgroundRun {
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

export function listBackgroundRuns(
  db: Database,
  input: { userId: string; limit?: number },
): BackgroundRun[] {
  return listRecentDelegationJobsForUser(db, input.userId, input.limit).map(toBackgroundRun)
}

/** Null when the id is unknown OR owned by another user — the caller maps both
 *  to the same 404, so a probe can't tell "not yours" from "doesn't exist". */
export function getBackgroundRun(
  db: Database,
  input: { userId: string; jobId: string },
): BackgroundRunDetail | null {
  const job = findDelegationJobById(db, input.jobId)
  if (job === null || job.userId !== input.userId) return null
  // The detail read admits EXACTLY what the list read admits (task rows —
  // `listRecentDelegationJobsForUser`'s NULL/'task' filter): delivery rows are
  // the notify mechanism, and agent-run rows are the mention machinery — a
  // detail readable but never listed would let the two reads disagree.
  if (job.jobKind !== null && job.jobKind !== 'task') return null

  const { resultPreview: _preview, ...run } = toBackgroundRun(job)
  return {
    ...run,
    result: job.resultText === '' ? null : job.resultText,
    taskText: job.taskText,
  }
}
