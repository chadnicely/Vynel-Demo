// The ONE home of the serve-time session-detail enrichment stack (2026-08-10,
// review finding: three routes carried verbatim copies). Every detail door —
// the workspace chat read, the root trace drill-down, and the cross-session
// tool read — serves the SAME content contract: a delegation-traced report row
// gains the task label (the Watch chip names the actual work), a delivered
// report gains its run stats, and a dispatch tool call gains its delegation
// outcome (the settled-history door).
//
// App-side by design: composing `@vynel/chat` (the detail) with
// `@vynel/session` (the enrichers) is exactly the cross-leaf seam routes own.

import type { Database } from '@vynel/db'
import type { ChatSessionDetail } from '@vynel/chat'
import type { PrimaryTranscript } from '@vynel/session/runtime'
import {
  attachDelegationTaskLabels,
  attachDeliveredRunStats,
  attachDelegationToolOutcomes,
} from '@vynel/session/delegation'

export function enrichChatSessionDetail(db: Database, detail: ChatSessionDetail) {
  return {
    session: detail.session,
    messages: attachDeliveredRunStats(db, attachDelegationTaskLabels(db, detail.messages)),
    toolCallsByMessageId: attachDelegationToolOutcomes(db, detail.toolCallsByMessageId),
  }
}

// The continuing-thread variant: the transcript's `session` is nullable (the
// scope may have no continuing conversation yet) — an empty transcript has
// nothing to enrich, a settled one rides the exact same stack above.
export function enrichPrimaryTranscript(db: Database, transcript: PrimaryTranscript) {
  return transcript.session === null
    ? transcript
    : enrichChatSessionDetail(db, {
        session: transcript.session,
        messages: transcript.messages,
        toolCallsByMessageId: transcript.toolCallsByMessageId,
      })
}
