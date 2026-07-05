// The api-side `approvals recovery` service — the 60s reaper for stale pending
// approvals (surface-up's unanswered bound). A recorded card nobody answers keeps
// its agent PARKED on the provider's canUseTool Promise (record-and-park), so the
// reaper both DENIES the provider approval (the parked turn resumes with the
// timeout steer) and marks the row `timed-out` (`recoverStalePendingApprovals`,
// which also sweeps post-restart rows whose registry died with the process).
// Fourth inhabitant of `services/` — the delegation-service shape (interval +
// in-flight guard is unnecessary here: a reap pass is short and idempotent).

import { recoverStalePendingApprovals, APPROVAL_TIMED_OUT_DENY_REASON } from '@vynel/approvals'
import type { Database } from '@vynel/db'
import type { Logger } from 'pino'
import type { AiAgentProvider } from '@vynel/providers'

const RECOVERY_INTERVAL_MS = 60_000

export interface ApprovalsRecoveryServiceOptions {
  db: Database
  logger: Logger
  provider: AiAgentProvider
}

export function startApprovalsRecoveryService(
  options: ApprovalsRecoveryServiceOptions,
): { stop: () => void } {
  const { db, logger, provider } = options

  const timer = setInterval(() => {
    recoverStalePendingApprovals(db, {
      logger,
      unblockProvider: (providerApprovalId) =>
        provider.respondToApprovalRequest(providerApprovalId, {
          kind: 'denied',
          reason: APPROVAL_TIMED_OUT_DENY_REASON,
        }),
    }).catch((err) => logger.error({ err }, 'approvals recovery tick failed'))
  }, RECOVERY_INTERVAL_MS)

  logger.info({}, 'approvals recovery service started (60s reaper)')

  return { stop: () => clearInterval(timer) }
}
