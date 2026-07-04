// Core op — soft-delete an approval rule with workspace-ownership check
// + no-enumeration leak. Sync (no provider call); transaction wraps the
// repo soft-delete + the outbox emission for atomicity.
//
// Called by the `DELETE /workspaces/:workspaceId/approval-rules/:ruleId`
// route. The repo's `softDeleteApprovalRule` throws on already-deleted
// (the WHERE clause filters active rows); this wrapper translates that
// to NotFoundError per error-handling.md layering.

import * as approvalRulesRepository from './repositories/index.js'
import { NotFoundError } from '@vynel/errors'
import type { ApprovalRule, StructuralLogger } from './approvals-types.js'
import { withTransaction, type Database } from '@vynel/db'

export type SoftDeleteApprovalRuleInput = {
  ruleId: string
  userId: string
  workspaceId: string
}

export function softDeleteApprovalRule(
  db: Database,
  input: SoftDeleteApprovalRuleInput,
  deps: { logger?: StructuralLogger } = {},
): ApprovalRule {
  const rule = approvalRulesRepository.findApprovalRuleById(db, input.ruleId)
  if (!rule) throw new NotFoundError('approval-rule', input.ruleId)
  if (rule.userId !== input.userId || rule.workspaceId !== input.workspaceId) {
    // No enumeration: same NotFoundError as missing.
    throw new NotFoundError('approval-rule', input.ruleId)
  }

  return withTransaction(db, (tx) => {
    try {
      const updated = approvalRulesRepository.softDeleteApprovalRule(tx, input.ruleId)
      deps.logger?.info({ ruleId: input.ruleId }, 'approval rule soft-deleted')
      // Phase 1 has no consumer for an `approval.rule-deleted` event; the
      // panel re-fetches via `listApprovalRulesForWorkspace`. If a future
      // consumer needs it (channels mirroring rule changes back to user
      // chats?), add the constant + emit here together.
      return updated
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('softDeleteApprovalRule:')) {
        // Raced with another delete; surface as NotFound to the caller.
        throw new NotFoundError('approval-rule', input.ruleId)
      }
      throw err
    }
  })
}
