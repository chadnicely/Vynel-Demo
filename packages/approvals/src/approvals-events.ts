// Outbox event type constants + payload interfaces for the `approvals`
// domain. Per D20: five lifecycle events. Each event row is co-committed
// in the same transaction as the state change (per the outbox infra
// workspaces shipped — `_shared/outbox-events` table + `_shared/outbox`
// repo).
//
// No `emit*` helpers — emission is a 5-line `insertOutboxEvent(tx, ...)`
// call inline in the core op, matching the chat precedent. Keeping the
// events file thin (constants + types only)
// avoids a per-domain abstraction layer that would diverge from chat's
// shape.
//
// Consumers downstream (chat outbox consumer mirroring onto
// `chat_tool_calls.approvalStatus`; future channels; future analytics)
// cast the outbox row's payload to the typed shape below.

import type { ActionKind, ApprovalResolutionKind, ApprovalRuleKind } from './approvals-types.js'

export const APPROVAL_REQUESTED = 'approval.requested' as const
export const APPROVAL_AUTO_RESOLVED = 'approval.auto-resolved' as const
export const APPROVAL_USER_RESOLVED = 'approval.user-resolved' as const
export const APPROVAL_TIMED_OUT = 'approval.timed-out' as const
export const APPROVAL_RULE_CREATED = 'approval.rule-created' as const

export type ApprovalRequestedPayload = {
  userId: string
  workspaceId: string
  sessionId: string
  parentMessageId: string
  toolUseId: string
  approvalRequestId: string // Vynel UUID; row PK
  providerApprovalId: string
  toolName: string
  actionKind: ActionKind
  requestedAt: Date
}

export type ApprovalResolvedPayload = {
  userId: string
  workspaceId: string
  sessionId: string
  parentMessageId: string
  toolUseId: string
  approvalRequestId: string
  providerApprovalId: string
  resolutionKind: ApprovalResolutionKind
  autoApprovedByRuleId: string | null
  resolvedAt: Date
}

export type ApprovalRuleCreatedPayload = {
  userId: string
  workspaceId: string
  ruleId: string
  ruleKind: ApprovalRuleKind
  description: string
  createdAt: Date
}
