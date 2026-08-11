// Zod request/query schemas for `phases` routes. XxxSchema suffix;
// API-internal (single consumer) so they live beside the routes. Validated
// via `validator` from `hono-openapi/zod`. Caps mirror the core op's
// PHASE_TITLE_MAX_LENGTH / PHASE_DESCRIPTION_MAX_LENGTH (the core op is the
// one home).

import { z } from 'zod'
import { PHASE_TITLE_MAX_LENGTH, PHASE_DESCRIPTION_MAX_LENGTH } from '@vynel/phases'

export const PhaseParamSchema = z.object({
  phaseId: z.string().min(1),
})

const PhaseStatusSchema = z.enum(['open', 'in-progress', 'done'])

export const ListPhasesQuerySchema = z.object({
  status: PhaseStatusSchema.optional(),
})

export const CreatePhaseRequestSchema = z.object({
  title: z.string().min(1).max(PHASE_TITLE_MAX_LENGTH),
  description: z.string().min(1).max(PHASE_DESCRIPTION_MAX_LENGTH),
  sessionId: z.string().min(1).optional(),
})

export const UpdatePhaseRequestSchema = z.object({
  title: z.string().min(1).max(PHASE_TITLE_MAX_LENGTH).optional(),
  description: z.string().min(1).max(PHASE_DESCRIPTION_MAX_LENGTH).optional(),
  status: PhaseStatusSchema.optional(),
  orderIndex: z.number().int().min(0).optional(),
})

// ── Response schemas ────────────────────────────────────────────────
// Structurally mirror `PhaseResponse` / `PhaseListItemResponse` from
// `@vynel/contracts/phases/phase-http` (the plans precedent) — declared here
// so `describeRoute` can attach real OpenAPI response bodies via `resolver()`.

const phaseResponseFields = {
  id: z.string(),
  userId: z.string(),
  workspaceId: z.string(),
  title: z.string(),
  orderIndex: z.number(),
  status: PhaseStatusSchema,
  sessionId: z.string().nullable(),
  completedAt: z.string().nullable(), // ISO-8601 or null
  createdAt: z.string(),
  updatedAt: z.string(),
}

export const PhaseResponseSchema = z.object({
  ...phaseResponseFields,
  description: z.string(),
})

export const PhaseListItemResponseSchema = z.object({
  ...phaseResponseFields,
  descriptionPreview: z.string(),
})

export const ListPhasesResponseSchema = z.array(PhaseListItemResponseSchema)
