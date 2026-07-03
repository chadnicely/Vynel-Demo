// HTTP shapes for the `approvals` domain. Serialized response shapes
// returned by routes in `apps/local-api/src/routes/approvals/index.ts`. Single
// source of truth: `apps/local-api` types its `serializeApprovalRequestForResponse`
// / `serializeApprovalRuleForResponse` return values as these; `apps/web`
// casts SDK responses to them (the routes carry no response schema in the
// OpenAPI spec, so the SDK can't infer — matches the workspaces +
// identity-files cast-from-contracts pattern). Promoted to
// `@vynel/contracts` on the `apps/web` second-consumer trigger per
// `coding-standard.md` "Zod schemas" + the `apps-web-foundation-design`
// decision.

export type ActionKind =
  | 'email-send'
  | 'file-write'
  | 'file-edit'
  | 'file-delete'
  | 'calendar-write'
  | 'shell-command'
  | 'external-action'
  | 'memory-write'
  | 'other'

export type ApprovalRequestStatus = 'pending' | 'resolved'

export type ApprovalResolutionKind = 'approved' | 'denied' | 'timed-out' | 'cancelled'

export type ApprovalRuleKind = 'auto-approve-action-kind' | 'auto-approve-tool-name'

export type ApprovalRuleMatcher =
  | { kind: 'auto-approve-action-kind'; actionKind: ActionKind }
  | { kind: 'auto-approve-tool-name'; toolName: string }

export interface ApprovalRequestResponse {
  id: string
  providerApprovalId: string
  sessionId: string
  parentMessageId: string
  toolUseId: string
  toolName: string
  actionKind: ActionKind
  toolInput: unknown
  status: ApprovalRequestStatus
  resolutionKind: ApprovalResolutionKind | null
  autoApprovedByRuleId: string | null
  /** ISO-8601 */
  requestedAt: string
  /** ISO-8601 */
  resolvedAt: string | null
}

export interface ApprovalRuleResponse {
  id: string
  ruleKind: ApprovalRuleKind
  description: string
  matcher: ApprovalRuleMatcher
  isEnabled: boolean
  /** ISO-8601 */
  createdAt: string
  /** ISO-8601 */
  updatedAt: string
}
