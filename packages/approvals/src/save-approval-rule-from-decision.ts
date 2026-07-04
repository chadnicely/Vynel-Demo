// Core helper — saves an approval rule from a user's "remember this"
// decision. Sync, called INSIDE a transaction by `resolveApproval` so
// the rule write is atomic with the resolution + the user-resolved
// outbox event.

import { randomUUID } from 'node:crypto'
import { insertOutboxEvent } from '@vynel/db/repositories/_shared'
import * as approvalRulesRepository from './repositories/index.js'
import { APPROVAL_RULE_CREATED, type ApprovalRuleCreatedPayload } from './approvals-events.js'
import { describeApprovalRule } from './describe-approval-rule.js'
import type { ApprovalRequest, ApprovalRule, ApprovalRuleMatcher } from './approvals-types.js'
import type { Database } from '@vynel/db'

export type RememberRuleInput =
  | { kind: 'auto-approve-action-kind' }
  | { kind: 'auto-approve-tool-name' }

export type SaveApprovalRuleFromDecisionInput = {
  userId: string
  workspaceId: string
  sourceRequest: ApprovalRequest
  rememberRule: RememberRuleInput
}

export function saveApprovalRuleFromDecision(
  db: Database,
  input: SaveApprovalRuleFromDecisionInput,
): ApprovalRule {
  const matcher = buildMatcherFromDecision(input.sourceRequest, input.rememberRule)
  const description = describeApprovalRule(matcher)
  const now = new Date()
  const rule = approvalRulesRepository.insertApprovalRule(db, {
    id: randomUUID(),
    userId: input.userId,
    workspaceId: input.workspaceId,
    ruleKind: input.rememberRule.kind,
    description,
    matcher,
    isEnabled: true,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  })
  insertOutboxEvent(db, {
    id: randomUUID(),
    type: APPROVAL_RULE_CREATED,
    payload: {
      userId: input.userId,
      workspaceId: input.workspaceId,
      ruleId: rule.id,
      ruleKind: rule.ruleKind,
      description: rule.description,
      createdAt: rule.createdAt,
    } satisfies ApprovalRuleCreatedPayload,
    createdAt: now,
    processedAt: null,
  })
  return rule
}

function buildMatcherFromDecision(
  sourceRequest: ApprovalRequest,
  rememberRule: RememberRuleInput,
): ApprovalRuleMatcher {
  switch (rememberRule.kind) {
    case 'auto-approve-action-kind':
      return { kind: 'auto-approve-action-kind', actionKind: sourceRequest.actionKind }
    case 'auto-approve-tool-name':
      return { kind: 'auto-approve-tool-name', toolName: sourceRequest.toolName }
  }
}
