// Domain-only types for the `approvals` core layer.
//
// `StructuralLogger` is owned by `@vynel/logger` (type-only — pino's
// runtime never reaches the core layer). Row types (ApprovalRequest,
// ApprovalRule) are re-exported from `@vynel/db` for consumer
// convenience.

export type { StructuralLogger } from '@vynel/logger'

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
} from './repositories/index.js'
