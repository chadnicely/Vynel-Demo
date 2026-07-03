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
    if (job.status === 'completed' && job.resultText) {
      return `— ${job.workspaceName}: ${job.resultText}`
    }
    // failed (or completed with no text) — the root must learn it did NOT finish, so it
    // never tells the user "still working" for a task that already gave up.
    return `— ${job.workspaceName}: (couldn't complete the task — ${job.errorMessage ?? 'no result'})`
  })

  const contextBlock =
    'Background reports from workspaces you delegated to have arrived. This is system-supplied ' +
    "context, NOT the user's message — use it to inform your reply and tell the user the " +
    'outcome (do not say a finished task is "still working"):\n' +
    lines.join('\n')

  return { contextBlock, jobIds: jobs.map((job) => job.id) }
}
