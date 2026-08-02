// Zod response schemas for the `rules` routes (read-only v1 — the view
// lists and opens rule files; editing stays out of scope). API-internal,
// under the route folder per `coding-standard.md` "Zod schemas".

import { z } from 'zod'

export const RuleRowSchema = z.object({
  ruleId: z.string(),
  fileName: z.string(),
  title: z.string(),
  /** Full markdown — rule files are small; powers the view dialog. */
  content: z.string(),
  scope: z.enum(['user', 'workspace']),
  /** Non-null = installed (and still managed) by the Vynel marketplace. */
  marketplace: z.object({ ruleId: z.string(), version: z.string() }).nullable(),
})

export const ListRulesResponseSchema = z.object({
  rules: z.array(RuleRowSchema),
})
