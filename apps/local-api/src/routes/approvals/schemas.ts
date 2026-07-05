// Request Zod schemas for the approvals routes — shared by the USER-scoped
// global queue (`./user-scoped.ts`) and the workspace-scoped surface
// (`./index.ts`: approvalsApp + approvalRulesApp).
//
// ── Response schemas ────────────────────────────────────────────────
// Structurally mirror `ApprovalRequestResponse` from
// `@vynel/contracts/approvals/approval-http` (the type
// `serializeApprovalRequestForResponse` is cast to). Declared here — not
// inverted to `z.infer` — because the canonical type lives in the shared
// contracts package (a second consumer, `apps/local-web`, already casts to
// it), not in this route's serializer; the schema exists so `describeRoute`
// can attach a real OpenAPI response body via `resolver()` (mirrors the
// workspaces group's identical cast-from-contracts fix).

import { z } from 'zod'

// A "remember this decision" rule is kind-only over the wire — the matcher's
// actionKind / toolName is derived server-side from the source request.
const RememberRuleInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('auto-approve-action-kind') }),
  z.object({ kind: z.literal('auto-approve-tool-name') }),
])

export const ResolveApprovalRequestBodySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('approved'),
    updatedInput: z.unknown().optional(),
    rememberRule: RememberRuleInputSchema.optional(),
  }),
  z.object({ kind: z.literal('denied'), reason: z.string().min(1).max(500) }),
])

export const ApprovalRequestParamSchema = z.object({ providerApprovalId: z.string().min(1) })

export const ApprovalRuleParamSchema = z.object({ ruleId: z.string().uuid() })

// The workspace pending list takes no query params — strict so an unknown
// param 400s at the boundary (source semantics).
export const ListPendingQuerySchema = z.object({}).strict()

export const ListRecentQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
  cursorRequestedAt: z.coerce.date().optional(),
  cursorId: z.string().uuid().optional(),
})

const ActionKindSchema = z.enum([
  'email-send',
  'file-write',
  'file-edit',
  'file-delete',
  'calendar-write',
  'shell-command',
  'external-action',
  'memory-write',
  'other',
])

const ApprovalRequestStatusSchema = z.enum(['pending', 'resolved'])

const ApprovalResolutionKindSchema = z.enum(['approved', 'denied', 'timed-out', 'cancelled'])

export const ApprovalRequestResponseSchema = z.object({
  id: z.string(),
  providerApprovalId: z.string(),
  // NULL for a global-root (brain) card; set for a workspace card.
  workspaceId: z.string().nullable(),
  sessionId: z.string(),
  parentMessageId: z.string(),
  toolUseId: z.string(),
  toolName: z.string(),
  actionKind: ActionKindSchema,
  toolInput: z.unknown(),
  status: ApprovalRequestStatusSchema,
  resolutionKind: ApprovalResolutionKindSchema.nullable(),
  autoApprovedByRuleId: z.string().nullable(),
  requestedAt: z.string(),
  resolvedAt: z.string().nullable(),
})

export const ApprovalRequestListResponseSchema = z.array(ApprovalRequestResponseSchema)

// Same wire shape under the user-scoped route's original export name — kept
// so `user-scoped.ts` reads unchanged after the file split.
export const ListPendingApprovalsResponseSchema = ApprovalRequestListResponseSchema

// ── Approval rules (workspace-scoped) ───────────────────────────────
// Structurally mirrors `ApprovalRuleResponse` from
// `@vynel/contracts/approvals/approval-http` (the type
// `serializeApprovalRuleForResponse` is cast to), same as the request shape.

const ApprovalRuleKindSchema = z.enum(['auto-approve-action-kind', 'auto-approve-tool-name'])

const ApprovalRuleMatcherSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('auto-approve-action-kind'), actionKind: ActionKindSchema }),
  z.object({ kind: z.literal('auto-approve-tool-name'), toolName: z.string() }),
])

export const ApprovalRuleResponseSchema = z.object({
  id: z.string(),
  ruleKind: ApprovalRuleKindSchema,
  description: z.string(),
  matcher: ApprovalRuleMatcherSchema,
  isEnabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const ApprovalRuleListResponseSchema = z.array(ApprovalRuleResponseSchema)
