// Enriches a thread's message DTOs with the delegated task each report row
// came from: a message carrying a `partialSessionId` (a bubbled-up report)
// gains `delegationTaskLabel` — the short label of the job's task text — so
// the Watch chip can name the actual work ("vynel · Set up the login page")
// instead of a canned "Watch <persona>". Lives HERE because it composes chat
// rows with orchestration jobs (the delegation-lift home; a leaf can't join
// its sibling). Loose-ref read at serve time — no schema change, terminal
// jobs keep their taskText, so settled history enriches the same as live.

import type { Database } from '@vynel/db'
import { findDelegationJobByPartialSessionId, isDeliveryJobKind } from '@vynel/orchestration'
import { deriveDelegationTaskLabel } from '@vynel/contracts/chat/delegation-task-label'

export function attachDelegationTaskLabels<
  TMessage extends { partialSessionId?: string | null },
>(db: Database, messages: TMessage[]): (TMessage & { delegationTaskLabel?: string })[] {
  // Several report rows can reference the same job — resolve each key once.
  const labelByKey = new Map<string, string | null>()
  return messages.map((message) => {
    const key = message.partialSessionId
    if (key === null || key === undefined) return message
    if (!labelByKey.has(key)) {
      const job = findDelegationJobByPartialSessionId(db, key)
      // A DELIVERY job's taskText is the report/update BODY, not a task — a
      // chip labeled with it would read as nonsense (and the delivery turn's
      // rows never chip anyway, session-comms). No label.
      const label =
        job === null || isDeliveryJobKind(job.jobKind)
          ? null
          : deriveDelegationTaskLabel(job.taskText)
      labelByKey.set(key, label === '' ? null : label)
    }
    const label = labelByKey.get(key) ?? null
    return label === null ? message : { ...message, delegationTaskLabel: label }
  })
}
