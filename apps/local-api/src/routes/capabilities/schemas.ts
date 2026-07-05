// Zod request schemas for the `capabilities` HTTP surface. API-internal
// (single consumer — apps/web via the SDK); not promoted to
// `@vynel/contracts` in Phase 1, matching the sibling route folders'
// "Zod schemas" convention.

import { z } from 'zod'

// The first-party capability ids. Marketplace capability ids (Phase C) widen
// this when that surface lands. Shared by the param schema below and the
// response schema's `id` field — one home for the enum.
const CapabilityIdSchema = z.enum(['memory', 'knowledge'])

// Path param.
export const CapabilityIdParamSchema = z.object({
  capabilityId: CapabilityIdSchema,
})

export const SetCapabilityEnabledBodySchema = z.object({
  isEnabled: z.boolean(),
})

// Phase 1: every capability is workspace-scoped (see capabilities-types.ts).
const CapabilityScopeSchema = z.enum(['workspace'])

// ── Response schemas ────────────────────────────────────────────────
// Mirrors `serializeStatus` in index.ts exactly — the flattened
// `{ ...capability, isEnabled }` shape each route returns.
export const CapabilityStatusSchema = z.object({
  id: CapabilityIdSchema,
  displayName: z.string(),
  description: z.string(),
  scope: CapabilityScopeSchema,
  isFirstParty: z.boolean(),
  isEnabled: z.boolean(),
})

export const ListCapabilitiesResponseSchema = z.object({
  capabilities: z.array(CapabilityStatusSchema),
})
