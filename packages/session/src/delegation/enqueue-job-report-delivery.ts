// ONE home for "Vynel speaks to the requester ON BEHALF of a job that did not
// speak for itself": the reporter provenance chain, the label fallback, the
// chain key, the origin channel, and the requester resolution. Two callers of
// the same addressing:
//
//   - the GIVE-UP push (`enqueueJobFailureDelivery`) — the job died; the
//     settle path and the delegation-service restart push both use it.
//   - the AUTO-REPORT (`enqueueAutoReportDelivery`, channel report protocol
//     2026-08-22) — the job COMPLETED but its turn never called send_message,
//     so the engine relays the turn's own final output as the report. The
//     protocol is "a task always reports to its requester"; this is what makes
//     that true even when the model forgets.
//
// Callers compose only the sentence; addressing lives here.

import type { Database } from '@vynel/db'
import {
  enqueueReportDelivery,
  readDelegationJobOrigin,
  resolveThreadIdOf,
  type DelegationJob,
  type ReportDeliveryRequester,
} from '@vynel/orchestration'
import { findWorkspaceById } from '@vynel/workspaces'

const TASK_PREVIEW_LIMIT = 160

/** The first line of an auto-report body — the requester's notify turn reads it
 *  verbatim, so it must SAY that nobody wrote this report. Deliberately not a
 *  column: `reportedAt` keeps its one meaning ("the running turn reported
 *  through the tool") and the fallback never stamps it. */
export const AUTO_REPORT_MARKER = '(auto-report: the task ended without reporting)'

/** The line under which a job report turns MODEL-DIRECTED. A report is written
 *  for the requester's assistant — "Tell the user it failed, and re-send it
 *  with send_message" is an instruction, and `<error>` payloads are raw
 *  machinery. Normally no person ever sees either: the assistant reads the
 *  report and writes its own answer. The channel FAILSAFE is the exception —
 *  it ships a report body verbatim to whoever is waiting on Telegram — so the
 *  sender-facing half goes above this line and the failsafe cuts here. */
export const REPORT_ASSISTANT_NOTES_MARKER = '--- for the assistant ---'

/** Compose a report the ENGINE writes as its two audiences: what the person who
 *  asked would read, and what the requester's assistant must do about it. ONE
 *  home for the sender-facing sentence — the failsafe has no other source for
 *  it, and a hand-rolled one per call site would drift. Every engine-authored
 *  report body that carries an instruction or an error payload goes through
 *  here; a CHILD's own report is prose for both audiences and needs none. */
export function composeReportWithAssistantNotes(input: {
  senderSentence: string
  assistantNotes: string
}): string {
  return `${input.senderSentence}\n\n${REPORT_ASSISTANT_NOTES_MARKER}\n${input.assistantNotes}`
}

/** The part of a report body a PERSON may read — what the channel failsafe
 *  ships. Drops a leading auto-report marker line (it explains the relay to the
 *  assistant, not to the sender) and everything from the assistant-notes marker
 *  down. A plain report (a child's own words) passes through untouched. */
export function extractSenderFacingReport(reportBody: string): string {
  const lines = reportBody.split('\n')
  const body = lines[0]?.trim() === AUTO_REPORT_MARKER ? lines.slice(1).join('\n') : reportBody
  return (body.split(REPORT_ASSISTANT_NOTES_MARKER)[0] ?? '').trim()
}

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

/** The shared addressing of a report enqueued FOR a job (never BY its turn):
 *  chain, provenance, label, requester, and the origin channel — carried so the
 *  requester's notify turn can answer where the user asked. */
function enqueueReportForJob(db: Database, job: DelegationJob, reportBody: string): string {
  const threadId = resolveThreadIdOf(job)
  const origin = readDelegationJobOrigin(job)
  return enqueueReportDelivery(db, {
    ...(threadId !== null ? { threadId } : {}),
    userId: job.userId,
    reporterSessionId: job.targetPrimarySessionId ?? job.workspaceId ?? job.parentSessionId,
    reporterLabel: job.workspaceName ?? 'Background task',
    reportBody,
    requester: resolveJobReportRequester(db, job),
    ...(origin !== null ? { origin } : {}),
  })
}

/** Enqueue a failure report-delivery addressed for the given WORK job. The
 *  caller owns kind-filtering (deliveries never push) and error handling. */
export function enqueueJobFailureDelivery(
  db: Database,
  job: DelegationJob,
  reportBody: string,
): string {
  return enqueueReportForJob(db, job, reportBody)
}

/** Enqueue the ENGINE's stand-in report for a completed job whose turn never
 *  sent one. The body is the turn's own final output under the auto-report
 *  marker, so the requester gets the real result and can see it was relayed,
 *  not spoken. Empty output still reports: silence is the thing this closes. */
export function enqueueAutoReportDelivery(
  db: Database,
  job: DelegationJob,
  resultText: string,
): string {
  const body = resultText.trim()
  return enqueueReportForJob(
    db,
    job,
    `${AUTO_REPORT_MARKER}\n\n${
      body === ''
        ? composeReportWithAssistantNotes({
            senderSentence:
              `Sorry — "${previewTaskText(job.taskText)}" finished without producing anything ` +
              'I can pass on.',
            assistantNotes:
              `The task "${previewTaskText(job.taskText)}" finished, but its turn produced no ` +
              'closing text at all — there is no result to relay. Check with the user before ' +
              'treating it as done.',
          })
        : body
    }`,
  )
}

/** The retry sentence-ending for a job's failure push, kind-aware: colleagues
 *  are re-mentioned; everything else is re-sent with send_message. */
export function jobRetryHint(job: DelegationJob): string {
  return job.jobKind === 'agent-run' && job.agentSlug !== null
    ? `mention the agent again (@${job.agentSlug}) to retry it.`
    : 're-send it with send_message if it should run again.'
}
