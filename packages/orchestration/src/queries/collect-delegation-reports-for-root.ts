// `collectDelegationReportsForRoot` — the global-root catch-up (brain-tree Ch3.5, the
// root-awareness fix). The async pass-and-push (Ch1) lands a delegation's report in the
// TRANSCRIPT but never in the root's SDK session, so on a follow-up the root resumes a
// conversation that's unaware the task finished — and says "still working". This collects
// the terminal delegations the root hasn't been told about (`surfacedToRootAt IS NULL`) and
// builds a system-framed context block the turn prepends to the PROVIDER's input — so the
// head learns what its hands reported. The caller marks them surfaced after (exactly-once).
//
// Reads the clean distilled `resultText` (or the failure note) straight off the job — no
// chat_messages join, and it covers the push-skipped case (job done, no UI push). Scoped by
// `userId` (one global root per user) so the compaction swap never enters the picture.

import type { Database } from '@vynel/db'
import { listUnsurfacedTerminalDelegationsForUser } from '../repositories/index.js'

export interface DelegationReportsForRoot {
  /** The system-framed block to prepend to the root turn's PROVIDER input — null when
   *  nothing is unseen (the turn runs with the user's message untouched). */
  contextBlock: string | null
  /** The surfaced jobs — the caller marks these `surfacedToRootAt` after building the turn. */
  jobIds: string[]
}

export function collectDelegationReportsForRoot(
  db: Database,
  input: { userId: string },
): DelegationReportsForRoot {
  const jobs = listUnsurfacedTerminalDelegationsForUser(db, input.userId)
  if (jobs.length === 0) return { contextBlock: null, jobIds: [] }

  const lines = jobs.map((job) => {
    // An agent-run is a colleague the USER @mentioned (the direct-reply
    // tweak): its reply already landed on the transcript with no narration —
    // this line is how the root LEARNS it, never a prompt to restate it. The
    // `workspaceName` column carries the AGENT's name on these rows.
    if (job.jobKind === 'agent-run') {
      const colleague = job.workspaceName ?? 'A colleague'
      if (job.reportedAt !== null) {
        return (
          `— ${colleague} (a colleague the user @mentioned) already replied DIRECTLY to the ` +
          `user; the reply is displayed in this conversation. Absorb it silently as context — ` +
          `do NOT restate or summarize it unless asked: ${job.resultText ?? '(reply delivered)'}`
        )
      }
      // The colleague finished without ever speaking — the root must say so.
      return `— ${colleague} (@mention) finished without sending a reply: ${
        job.resultText ?? job.errorMessage ?? 'no result'
      }`
    }
    // Session-target jobs (Slice ④) have no workspace name — a generic label
    // keeps the block honest (the report text itself names the work).
    const sourceName = job.workspaceName ?? 'A session you created'
    // A REPORTED task row reaching the net means its final answer went
    // `direct_to_user` (every other reported task is surfaced at completion /
    // timeout) — the answer is already on the transcript, whatever the row's
    // own terminal status.
    if (job.reportedAt !== null) {
      return (
        `— ${sourceName} already sent its result DIRECTLY to the user; it is displayed in ` +
        `this conversation. Absorb it silently as context — do NOT restate or summarize it ` +
        `unless asked: ${job.resultText ?? '(answer delivered)'}`
      )
    }
    if (job.status === 'completed' && job.resultText) {
      return `— ${sourceName}: ${job.resultText}`
    }
    // failed (or completed with no text) — the root must learn it did NOT finish, so it
    // never tells the user "still working" for a task that already gave up.
    return `— ${sourceName}: (couldn't complete the task — ${job.errorMessage ?? 'no result'})`
  })

  const contextBlock =
    'Background reports from work you delegated have arrived. This is system-supplied ' +
    "context, NOT the user's message — use it to inform your reply and tell the user the " +
    'outcome (do not say a finished task is "still working"; items marked to absorb ' +
    'silently are already visible to the user — never restate those):\n' +
    lines.join('\n')

  return { contextBlock, jobIds: jobs.map((job) => job.id) }
}
