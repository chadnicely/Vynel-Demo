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
