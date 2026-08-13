// Zod schemas for the `/tool-policies` surface. The vocabulary derives from
// the capabilities package's unions + the contracts' feature keys — one
// source of truth each; the route validates at the boundary.

import { z } from 'zod'
import { SESSION_SURFACE_KINDS } from '@vynel/capabilities'
import { ALL_FEATURE_KEYS } from '@vynel/contracts/hub/entitlements'
import { CAPABILITY_CATALOG } from '@vynel/capabilities'

const CARD_CLASS_VALUES = ['never', 'ask', 'always'] as const

export const ToolNameParamSchema = z.object({
  // Full `mcp__<server>__<tool>` names only — the same key every policy
  // surface uses. Existence against the live catalog is checked in-handler.
  toolName: z.string().regex(/^mcp__[a-z0-9-]+__[a-z0-9_]+$/),
})

const capabilityIds = CAPABILITY_CATALOG.map((capability) => capability.id)

// PUT body — FULL-REPLACE override semantics: null = inherit the declared
// default; 'none' on the gate fields = ungate. An all-null body resets.
export const SaveToolPolicyBodySchema = z.object({
  enabled: z.boolean().nullable(),
  cardClass: z.enum(CARD_CLASS_VALUES).nullable(),
  surfaces: z.array(z.enum(SESSION_SURFACE_KINDS)).nullable(),
  featureKey: z
    .enum(['none', ...ALL_FEATURE_KEYS] as [string, ...string[]])
    .nullable(),
  capabilityId: z.enum(['none', ...capabilityIds] as [string, ...string[]]).nullable(),
})

export const EffectiveToolPolicySchema = z.object({
  toolName: z.string(),
  serverName: z.string(),
  enabled: z.boolean(),
  surfaces: z.array(z.enum(SESSION_SURFACE_KINDS)),
  cardClass: z.enum(CARD_CLASS_VALUES),
  featureKey: z.string().optional(),
  capabilityId: z.string().optional(),
  hasOverride: z.boolean(),
})

export const ListToolPoliciesResponseSchema = z.object({
  tools: z.array(EffectiveToolPolicySchema),
})
