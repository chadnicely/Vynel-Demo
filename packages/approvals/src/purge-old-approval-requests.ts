// Worker core op — daily hard-delete of `approval_requests` rows older
// than 90 days. Audit retention window — long enough for compliance
// lookback, short enough to keep storage bounded.
//
// No outbox event on purge (consumers don't need to know audit was
// reaped). Same shape as chat's purgeDeletedChatSessions.

import * as approvalRequestsRepository from '@vynel/db/repositories/approvals'
import type { Database } from '@vynel/db'
import type { StructuralLogger } from './approvals-types.js'

const RETENTION_DAYS = 90
const MS_PER_DAY = 24 * 60 * 60 * 1000

export type PurgeOldApprovalRequestsResult = { purgedCount: number }

export function purgeOldApprovalRequests(
  db: Database,
  deps: { logger?: StructuralLogger; now?: () => Date } = {},
): PurgeOldApprovalRequestsResult {
  const now = (deps.now ?? (() => new Date()))()
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * MS_PER_DAY)
  const purgedCount = approvalRequestsRepository.hardDeleteApprovalRequestsRequestedBefore(
    db,
    cutoff,
  )
  if (purgedCount > 0) {
    deps.logger?.info(
      { purgedCount, cutoff },
      'purgeOldApprovalRequests: hard-deleted aged audit rows',
    )
  }
  return { purgedCount }
}
