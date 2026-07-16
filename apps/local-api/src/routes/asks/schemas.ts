// Zod request schemas for `asks` routes. The question/answer shapes come from
// `@vynel/contracts/asks` (one home — the tool, the ops, and this boundary
// all validate against the same schemas).

import { z } from 'zod'
import { AskAnswersSchema, AskQuestionsSchema } from '@vynel/contracts/asks/ask-questions'

export const AskParamSchema = z.object({
  askId: z.string().min(1),
})

export const AnswerAskRequestSchema = z.object({
  answers: AskAnswersSchema,
})

// ── Response schemas ────────────────────────────────────────────────
// Structurally mirror `AskRequestResponse` from `@vynel/contracts/asks/ask-http`
// (the tasks/schedules precedent — canonical type in contracts, schema here so
// `describeRoute` attaches a real OpenAPI body via `resolver()`).

const AskStatusResponseSchema = z.enum(['pending', 'answered', 'dismissed', 'expired'])

export const AskRequestResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  // Null = the ask came from a global-root turn (no workspace).
  workspaceId: z.string().nullable(),
  sessionId: z.string().nullable(),
  questions: AskQuestionsSchema,
  answers: AskAnswersSchema.nullable(),
  status: AskStatusResponseSchema,
  createdAt: z.string(),
  resolvedAt: z.string().nullable(), // ISO-8601 or null
})

export const ListPendingAsksResponseSchema = z.array(AskRequestResponseSchema)
