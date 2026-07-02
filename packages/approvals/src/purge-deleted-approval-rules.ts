// Worker core op — daily hard-delete of `approval_rules` rows with
// `deletedAt < now - 30d`. Matches chat's purgeDeletedChatSessions
// precedent exactly. Per D14: 30-day soft-delete + retention + purge.

import * as approvalRulesRepository from '@vynel/db/repositories/approvals'
import type { Database } from '@vynel/db'
import type { StructuralLogger } from './approvals-types.js'

const RETENTION_DAYS = 30
const MS_PER_DAY = 24 * 60 * 60 * 1000

export type PurgeDeletedApprovalRulesResult = { purgedCount: number }

export function purgeDeletedApprovalRules(
  db: Database,
  deps: { logger?: StructuralLogger; now?: () => Date } = {},
): PurgeDeletedApprovalRulesResult {
  const now = (deps.now ?? (() => new Date()))()
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * MS_PER_DAY)
  const expired = approvalRulesRepository.listSoftDeletedApprovalRulesBefore(db, cutoff)
  if (expired.length === 0) return { purgedCount: 0 }
  const purgedCount = approvalRulesRepository.hardDeleteApprovalRulesById(
    db,
    expired.map((rule) => rule.id),
  )
  deps.logger?.info(
    { purgedCount, cutoff },
    'purgeDeletedApprovalRules: hard-deleted aged soft-deleted rules',
  )
  return { purgedCount }
}
