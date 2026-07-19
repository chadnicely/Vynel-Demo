// Reaper core op — resolves stale pending approval rows as `timed-out`. Runs on
// the api-side approvals-recovery interval (60s).
//
// TWO staleness cases, one op:
//   - SAME-PROCESS (surface-up): a recorded card nobody answered while an agent
//     is PARKED on the provider's canUseTool Promise. `deps.unblockProvider` is
//     the live escape hatch — deny the provider approval so the parked turn
//     resumes (with the timeout reason), THEN mark the row. Without it the row
//     would read timed-out while the agent hangs forever.
//   - POST-RESTART: the provider's in-memory PendingApprovalRegistry died with
//     the process; only the audit row remains. `unblockProvider` then throws
//     NotFoundError (unknown id) — logged and ignored; the row update is all
//     there is to do.
//
// Safety window: row staleness is calculated as
//   requestedAt + timeoutMs * 2 < now
// to allow tick latency + process-restart recovery without firing on
// approvals the user might still be actively deciding.

import { randomUUID } from 'node:crypto'
import { NotFoundError } from '@vynel/errors'
import * as approvalRequestsRepository from '../repositories/index.js'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import { APPROVAL_TIMED_OUT, type ApprovalResolvedPayload } from '../approvals-events.js'
import type { StructuralLogger } from '../approvals-types.js'
import { withTransaction, type Database } from '@vynel/db'

const SAFETY_LOOKBACK_MS = 60_000 // 1 minute — anything younger can't be stale yet at the 5-min default

/** The reason a parked agent sees when its approval times out — steers it to report
 *  as text rather than retry the tool. */
export const APPROVAL_TIMED_OUT_DENY_REASON =
  'No decision arrived in time — the approval timed out. Report what you have as text; ' +
  'do not retry this tool.'

export type RecoverStalePendingApprovalsResult = { resolvedCount: number }

export async function recoverStalePendingApprovals(
  db: Database,
  deps: {
    logger?: StructuralLogger
    now?: () => Date
    /** Deny the provider-side approval so a same-process parked agent resumes
     *  (`provider.respondToApprovalRequest(id, denied)`). Throws NotFoundError for a
     *  post-restart id the registry no longer knows — caught + logged here. */
    unblockProvider?: (providerApprovalId: string) => Promise<void>
    /** BOOT recovery: the waiter registry died with the previous process, so
     *  EVERY pending row is an orphan — reap regardless of age (the staleness
     *  window exists to protect live parked turns; at boot there are none).
     *  Without this, a dev-restart mid-turn leaves ghost cards for up to
     *  `timeoutMs * 2`. */
    reapAllPending?: boolean
  } = {},
): Promise<RecoverStalePendingApprovalsResult> {
  const now = (deps.now ?? (() => new Date()))()
  const reapAllPending = deps.reapAllPending ?? false

  // Fetch any pending row older than the safety lookback. Per-row check
  // uses `requestedAt + timeoutMs * 2` since timeoutMs may differ per
  // row (channels may use longer windows).
  const candidates = approvalRequestsRepository.listStalePendingApprovalRequests(db, {
    staleBefore: reapAllPending ? now : new Date(now.getTime() - SAFETY_LOOKBACK_MS),
    limit: 500,
  })

  let resolvedCount = 0
  for (const row of candidates) {
    const staleAt = new Date(row.requestedAt.getTime() + row.timeoutMs * 2)
    if (!reapAllPending && staleAt >= now) continue

    // Unblock a same-process parked agent BEFORE the row update (the resolveApproval
    // ordering invariant: provider first — the inverse failure mode leaves the agent
    // waiting forever). NotFound = a post-restart id the registry no longer knows —
    // proceed to the row update, which is all that remains to do. ANY OTHER failure
    // skips the row this tick (it stays pending; the next tick retries) — marking it
    // timed-out would permanently strip reaper coverage from a possibly-still-parked
    // agent, the exact forever-park this op exists to kill.
    //
    // Kind trade-off, deliberate: the parked agent sees a DENIAL (the breaker counts
    // it + the model gets the report-as-text steer) while the audit row reads
    // `timed-out` (the truthful history for the user).
    if (deps.unblockProvider !== undefined) {
      try {
        await deps.unblockProvider(row.providerApprovalId)
      } catch (err) {
        if (err instanceof NotFoundError) {
          deps.logger?.info(
            { providerApprovalId: row.providerApprovalId },
            'recoverStalePendingApprovals: no parked provider approval to unblock (post-restart row)',
          )
        } else {
          deps.logger?.error(
            { providerApprovalId: row.providerApprovalId, error: err instanceof Error ? err.message : String(err) },
            'recoverStalePendingApprovals: provider unblock failed — row kept pending for the next tick',
          )
          continue
        }
      }
    }

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
