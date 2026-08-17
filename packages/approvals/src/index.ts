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

export { evaluateApprovalRules } from './rules/evaluate-approval-rules.js'
export type { EvaluateApprovalRulesInput, RuleMatch } from './rules/evaluate-approval-rules.js'

export { describeApprovalRule } from './rules/describe-approval-rule.js'

export { recordApprovalRequest } from './requests/record-approval-request.js'
export type {
  RecordApprovalRequestInput,
  RecordApprovalRequestOutput,
} from './requests/record-approval-request.js'

export { resolveApproval } from './requests/resolve-approval.js'
export type { ResolveApprovalInput, RememberRuleInput } from './requests/resolve-approval.js'

// The global approval-queue read — every pending card for a user across all
// sessions/workspaces + the brain (the "answer from any screen" surface; its HTTP
// route lands with apps/api).
export { listPendingApprovalsForUser } from './repositories/index.js'
// The raw row insert — consumers' test fixtures seed pending cards with it
// (the sessions-overview statusFacts tests); production writes go through
// `recordApprovalRequest`.
export { insertApprovalRequest } from './repositories/index.js'

// Workspace-scoped reads for the HTTP surface (apps/local-api): the pending /
// recent audit views, the rules panel list, and the decide route's workspace
// ownership pre-check.
export {
  findApprovalRequestByProviderApprovalId,
  listApprovalRequestsForWorkspace,
  listApprovalRulesForWorkspace,
} from './repositories/index.js'
export type { ListApprovalRequestsForWorkspaceOptions } from './repositories/index.js'

export { saveApprovalRuleFromDecision } from './rules/save-approval-rule-from-decision.js'
export type { SaveApprovalRuleFromDecisionInput } from './rules/save-approval-rule-from-decision.js'

export { softDeleteApprovalRule } from './rules/soft-delete-approval-rule.js'
export type { SoftDeleteApprovalRuleInput } from './rules/soft-delete-approval-rule.js'

export {
  recoverStalePendingApprovals,
  APPROVAL_TIMED_OUT_DENY_REASON,
} from './requests/recover-stale-pending-approvals.js'
export type { RecoverStalePendingApprovalsResult } from './requests/recover-stale-pending-approvals.js'

export { purgeOldApprovalRequests } from './requests/purge-old-approval-requests.js'
export type { PurgeOldApprovalRequestsResult } from './requests/purge-old-approval-requests.js'

export { purgeDeletedApprovalRules } from './rules/purge-deleted-approval-rules.js'
export type { PurgeDeletedApprovalRulesResult } from './rules/purge-deleted-approval-rules.js'
