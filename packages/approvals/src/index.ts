// Public surface of the `approvals` domain.

export type { StructuralLogger } from './approvals-types.js'
export type {
  ApprovalRequest,
  NewApprovalRequest,
  ActionKind,
  ApprovalRequestStatus,
  ApprovalResolutionKind,
  ApprovalRule,
  NewApprovalRule,
  ApprovalRuleKind,
  ApprovalRuleMatcher,
} from './approvals-types.js'

export {
  APPROVAL_REQUESTED,
  APPROVAL_AUTO_RESOLVED,
  APPROVAL_USER_RESOLVED,
  APPROVAL_TIMED_OUT,
  APPROVAL_RULE_CREATED,
} from './approvals-events.js'
export type {
  ApprovalRequestedPayload,
  ApprovalResolvedPayload,
  ApprovalRuleCreatedPayload,
} from './approvals-events.js'

export { deriveActionKind, ACTION_KIND_MAPPINGS } from './derive-action-kind.js'
export type { ActionKindMapping } from './derive-action-kind.js'

export { evaluateApprovalRules } from './evaluate-approval-rules.js'
export type { EvaluateApprovalRulesInput, RuleMatch } from './evaluate-approval-rules.js'

export { describeApprovalRule } from './describe-approval-rule.js'

export { recordApprovalRequest } from './record-approval-request.js'
export type {
  RecordApprovalRequestInput,
  RecordApprovalRequestOutput,
} from './record-approval-request.js'

export { resolveApproval } from './resolve-approval.js'
export type { ResolveApprovalInput, RememberRuleInput } from './resolve-approval.js'

export { saveApprovalRuleFromDecision } from './save-approval-rule-from-decision.js'
export type { SaveApprovalRuleFromDecisionInput } from './save-approval-rule-from-decision.js'

export { softDeleteApprovalRule } from './soft-delete-approval-rule.js'
export type { SoftDeleteApprovalRuleInput } from './soft-delete-approval-rule.js'

export { recoverStalePendingApprovals } from './recover-stale-pending-approvals.js'
export type { RecoverStalePendingApprovalsResult } from './recover-stale-pending-approvals.js'

export { purgeOldApprovalRequests } from './purge-old-approval-requests.js'
export type { PurgeOldApprovalRequestsResult } from './purge-old-approval-requests.js'

export { purgeDeletedApprovalRules } from './purge-deleted-approval-rules.js'
export type { PurgeDeletedApprovalRulesResult } from './purge-deleted-approval-rules.js'
