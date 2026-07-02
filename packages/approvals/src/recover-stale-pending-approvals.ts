// Worker core op — resolves stale pending approval rows as `timed-out`.
// Runs every 60 seconds via the apps/worker scheduler (D5 revised; chat
// worker-thin-delegator precedent).
//
// Sync — no provider call. Provider's in-memory PendingApprovalRegistry
// is gone with the process; the SDK's awaiting Promise is gone too. All
// that remains is the audit row, which we mark `timed-out` so the chat
// UI shows the correct state on next session open and downstream
// consumers (chat outbox mirror, channels) see the resolution.
//
// Safety window: row staleness is calculated as
//   requestedAt + timeoutMs * 2 < now
// to allow tick latency + process-restart recovery without firing on
// approvals the user might still be actively deciding.

import { randomUUID } from 'node:crypto'
import * as approvalRequestsRepository from '@vynel/db/repositories/approvals'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { APPROVAL_TIMED_OUT, type ApprovalResolvedPayload } from './approvals-events.js'
import type { StructuralLogger } from './approvals-types.js'
import { withTransaction, type Database } from '@vynel/db'

const SAFETY_LOOKBACK_MS = 60_000 // 1 minute — anything younger can't be stale yet at the 5-min default

export type RecoverStalePendingApprovalsResult = { resolvedCount: number }

export function recoverStalePendingApprovals(
  db: Database,
  deps: { logger?: StructuralLogger; now?: () => Date } = {},
): RecoverStalePendingApprovalsResult {
  const now = (deps.now ?? (() => new Date()))()

  // Fetch any pending row older than the safety lookback. Per-row check
  // uses `requestedAt + timeoutMs * 2` since timeoutMs may differ per
  // row (channels may use longer windows).
  const candidates = approvalRequestsRepository.listStalePendingApprovalRequests(db, {
    staleBefore: new Date(now.getTime() - SAFETY_LOOKBACK_MS),
    limit: 500,
  })

  let resolvedCount = 0
  for (const row of candidates) {
    const staleAt = new Date(row.requestedAt.getTime() + row.timeoutMs * 2)
    if (staleAt >= now) continue

    withTransaction(db, (tx) => {
      const next = approvalRequestsRepository.updateApprovalRequest(tx, row.id, {
        status: 'resolved',
        resolutionKind: 'timed-out',
        resolvedAt: now,
      })
      insertOutboxEvent(tx, {
        id: randomUUID(),
        type: APPROVAL_TIMED_OUT,
        payload: {
          userId: next.userId,
          workspaceId: next.workspaceId,
          sessionId: next.sessionId,
          parentMessageId: next.parentMessageId,
          toolUseId: next.toolUseId,
          approvalRequestId: next.id,
          providerApprovalId: next.providerApprovalId,
          resolutionKind: 'timed-out',
          autoApprovedByRuleId: null,
          resolvedAt: now,
        } satisfies ApprovalResolvedPayload,
        createdAt: now,
        processedAt: null,
      })
    })
    resolvedCount += 1
  }

  if (resolvedCount > 0) {
    deps.logger?.info(
      { resolvedCount, candidatesScanned: candidates.length },
      'recoverStalePendingApprovals: resolved stale rows',
    )
  }
  return { resolvedCount }
}
