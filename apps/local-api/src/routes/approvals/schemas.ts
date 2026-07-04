// Request Zod schemas for the approvals routes
// (`apps/local-api/src/routes/approvals/index.ts`). RESPONSE shapes are cast from
// `@vynel/contracts` (`ApprovalRequestResponse`) per the approvals
// cast-from-contracts convention (`approval-http.ts`) — so no response Zod lives
// here (contrast the knowledge routes' `resolver()` schemas).

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
