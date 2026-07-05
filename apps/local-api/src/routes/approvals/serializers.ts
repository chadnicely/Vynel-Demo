// Maps an `approval_requests` row to its HTTP response shape. The approvals
// domain uses the cast-from-contracts convention (`@vynel/contracts`
// `approval-http.ts`): `apps/local-web` casts SDK responses to
// `ApprovalRequestResponse`. This function is the single source of truth those
// casts trust — it drops the tenant/internal columns (userId, resolutionReason,
// resolutionUpdatedInput, timeoutMs) and renders Dates as ISO. `./schemas.js`
// (`ApprovalRequestResponseSchema`) mirrors this exact shape so the OpenAPI spec
// — and therefore the generated SDK return type — is real, not `never`.

import type { ApprovalRequest, ApprovalRule } from '@vynel/approvals'
import type {
  ApprovalRequestResponse,
  ApprovalRuleResponse,
} from '@vynel/contracts/approvals/approval-http'

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

// Same convention for `approval_rules` rows (the workspace-scoped rules panel):
// drops the tenant columns (userId, workspaceId, deletedAt) and renders Dates
// as ISO. `ApprovalRuleResponseSchema` in `./schemas.js` mirrors this shape.
export function serializeApprovalRuleForResponse(row: ApprovalRule): ApprovalRuleResponse {
  return {
    id: row.id,
    ruleKind: row.ruleKind,
    description: row.description,
    matcher: row.matcher,
    isEnabled: row.isEnabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
