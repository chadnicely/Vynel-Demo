// Zod request + response schemas for the `rules` routes. API-internal, under
// the route folder per `coding-standard.md` "Zod schemas". Length caps mirror
// the skills leaf's own-rule writer (the core re-validates; this bounds the
// wire).

import { z } from 'zod'
import { MAX_RULE_FILE_LENGTH, MAX_RULE_ID_LENGTH } from '@vynel/skills'

export const RuleScopeSchema = z.enum(['user', 'workspace'])

export const RuleRowSchema = z.object({
  ruleId: z.string(),
  fileName: z.string(),
  title: z.string(),
  /** Full markdown — rule files are small; powers the view dialog. */
  content: z.string(),
  /** `content` without the marketplace marker line — what the editor edits. */
  body: z.string(),
  scope: RuleScopeSchema,
  /** Non-null = installed (and still managed) by the Vynel marketplace. */
  marketplace: z.object({ ruleId: z.string(), version: z.string() }).nullable(),
})

export const ListRulesResponseSchema = z.object({
  rules: z.array(RuleRowSchema),
})

// A workspace turn's resolved view sees the user folder + that workspace's;
// omit for the global surface (user folder only).
export const ResolvedRulesQuerySchema = z.object({
  workspaceId: z.string().min(1).optional(),
})

// The file name without `.md`. Path safety (one segment, no `..`, no leading
// dot) is the skills leaf's `isSafeRuleId` — it answers 400 through the
// typed ValidationError, so the wire only bounds the length here.
export const RuleIdParamSchema = z.object({
  ruleId: z.string().min(1).max(MAX_RULE_ID_LENGTH),
})

export const WriteRuleBodySchema = z.object({
  scope: RuleScopeSchema,
  // Required when scope is 'workspace'; ignored for 'user' (a workspace
  // turn's ambient stamp may attach one) — `resolveScopeTarget` decides.
  workspaceId: z.string().min(1).optional(),
  content: z.string().min(1).max(MAX_RULE_FILE_LENGTH),
})

export const RuleScopeQuerySchema = z.object({
  scope: RuleScopeSchema,
  workspaceId: z.string().min(1).optional(),
})
