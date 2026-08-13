// Zod request/query schemas for `features` routes. XxxSchema suffix;
// API-internal (single consumer) so they live beside the routes. Validated
// via `validator` from `hono-openapi/zod`. Caps mirror the core op's
// FEATURE_TITLE_MAX_LENGTH / FEATURE_DESCRIPTION_MAX_LENGTH (the core op is
// the one home).

import { z } from 'zod'
import { FEATURE_TITLE_MAX_LENGTH, FEATURE_DESCRIPTION_MAX_LENGTH } from '@vynel/features'

export const FeatureParamSchema = z.object({
  featureId: z.string().min(1),
})

const FeatureStatusSchema = z.enum(['open', 'in-progress', 'done'])

export const ListFeaturesQuerySchema = z.object({
  status: FeatureStatusSchema.optional(),
  phaseId: z.string().min(1).optional(),
})

export const CreateFeatureRequestSchema = z.object({
  title: z.string().min(1).max(FEATURE_TITLE_MAX_LENGTH),
  description: z.string().min(1).max(FEATURE_DESCRIPTION_MAX_LENGTH),
  phaseId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
})

export const UpdateFeatureRequestSchema = z.object({
  title: z.string().min(1).max(FEATURE_TITLE_MAX_LENGTH).optional(),
  description: z.string().min(1).max(FEATURE_DESCRIPTION_MAX_LENGTH).optional(),
  status: FeatureStatusSchema.optional(),
  // null unlinks the feature from its phase.
  phaseId: z.string().min(1).nullable().optional(),
})

// ── Response schemas ────────────────────────────────────────────────
// Structurally mirror `FeatureResponse` / `FeatureListItemResponse` from
// `@vynel/contracts/features/feature-http` (the plans precedent) — declared
// here so `describeRoute` can attach real OpenAPI response bodies via
// `resolver()`.

const featureResponseFields = {
  id: z.string(),
  userId: z.string(),
  workspaceId: z.string(),
  title: z.string(),
  phaseId: z.string().nullable(),
  status: FeatureStatusSchema,
  sessionId: z.string().nullable(),
  completedAt: z.string().nullable(), // ISO-8601 or null
  createdAt: z.string(),
  updatedAt: z.string(),
}

export const FeatureResponseSchema = z.object({
  ...featureResponseFields,
  description: z.string(),
})

export const FeatureListItemResponseSchema = z.object({
  ...featureResponseFields,
  descriptionPreview: z.string(),
})

export const ListFeaturesResponseSchema = z.array(FeatureListItemResponseSchema)
