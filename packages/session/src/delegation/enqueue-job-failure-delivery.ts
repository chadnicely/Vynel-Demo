// `enqueueJobFailureDelivery` — ONE home for "tell the requester this job
// died": the reporter provenance chain, the label fallback, the chain key, and
// the requester resolution that the give-up push (settle) and the restart
// push (delegation-service startup) must never drift on. Callers compose only
// the sentence; addressing lives here.

import type { Database } from '@vynel/db'
import {
  enqueueReportDelivery,
  resolveThreadIdOf,
  type DelegationJob,
  type ReportDeliveryRequester,
} from '@vynel/orchestration'
import { findWorkspaceById } from '@vynel/workspaces'

const TASK_PREVIEW_LIMIT = 160

/** The requester a job's reports address: its recorded originating-chat
 *  workspace when it still exists, else the global root. */
export function resolveJobReportRequester(
  db: Database,
  claimed: DelegationJob,
): ReportDeliveryRequester {
  if (claimed.requesterWorkspaceId !== null) {
    const workspace = findWorkspaceById(db, claimed.requesterWorkspaceId)
    if (workspace !== null && workspace.userId === claimed.userId) {
      return {
        kind: 'workspace-primary',
        workspaceId: workspace.id,
        workspacePath: workspace.path,
      }
    }
  }
  return { kind: 'global-root' }
}

/** The failed job's task, shortened for a failure sentence. */
export function previewTaskText(taskText: string): string {
  return taskText.length > TASK_PREVIEW_LIMIT ? `${taskText.slice(0, TASK_PREVIEW_LIMIT)}…` : taskText
}

/** Enqueue a failure report-delivery addressed for the given WORK job. The
 *  caller owns kind-filtering (deliveries never push) and error handling. */
export function enqueueJobFailureDelivery(
  db: Database,
  job: DelegationJob,
  reportBody: string,
): string {
  const threadId = resolveThreadIdOf(job)
  return enqueueReportDelivery(db, {
    ...(threadId !== null ? { threadId } : {}),
    userId: job.userId,
    reporterSessionId: job.targetPrimarySessionId ?? job.workspaceId ?? job.parentSessionId,
    reporterLabel: job.workspaceName ?? 'Background task',
    reportBody,
    requester: resolveJobReportRequester(db, job),
  })
}

/** The retry sentence-ending for a job's failure push, kind-aware: colleagues
 *  are re-mentioned; everything else is re-sent with send_message. */
export function jobRetryHint(job: DelegationJob): string {
  return job.jobKind === 'agent-run' && job.agentSlug !== null
    ? `mention the agent again (@${job.agentSlug}) to retry it.`
    : 're-send it with send_message if it should run again.'
}
