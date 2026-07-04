// Maps an `approval_requests` row to its HTTP response shape. The approvals
// domain uses the cast-from-contracts convention (`@vynel/contracts`
// `approval-http.ts`): routes carry no response Zod; `apps/web` casts SDK
// responses to `ApprovalRequestResponse`. This function is the single source of
// truth those casts trust — it drops the tenant/internal columns (userId,
// resolutionReason, resolutionUpdatedInput, timeoutMs) and renders Dates as ISO.

import type { ApprovalRequest } from '@vynel/approvals'
import type { ApprovalRequestResponse } from '@vynel/contracts/approvals/approval-http'

export function serializeApprovalRequestForResponse(row: ApprovalRequest): ApprovalRequestResponse {
  return {
    id: row.id,
    providerApprovalId: row.providerApprovalId,
    workspaceId: row.workspaceId,
    sessionId: row.sessionId,
    parentMessageId: row.parentMessageId,
    toolUseId: row.toolUseId,
    toolName: row.toolName,
    actionKind: row.actionKind,
    toolInput: row.toolInput,
    status: row.status,
    resolutionKind: row.resolutionKind,
    autoApprovedByRuleId: row.autoApprovedByRuleId,
    requestedAt: row.requestedAt.toISOString(),
    resolvedAt: row.resolvedAt !== null ? row.resolvedAt.toISOString() : null,
  }
}
