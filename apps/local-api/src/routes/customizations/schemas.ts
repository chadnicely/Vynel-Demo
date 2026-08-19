// Zod schemas for the customizations routes — the wire shape of everything
// the user arranges (per-scope looks + the tree's positions). Structurally
// mirror `@vynel/contracts/customization/customization-http`; the core op
// guards what a schema can't (real hex, real image, one colour choice).

import { z } from 'zod'

// The scope key is a workspace id or `global` — never a path segment surprise.
export const ScopeKeyParamSchema = z.object({ scopeKey: z.string().min(1).max(64) })

const MenuGroupLayoutSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(60),
})

const MenuEntryLayoutSchema = z.object({
  sectionId: z.string().min(1).max(64),
  groupId: z.string().min(1).max(64).nullable(),
  isHidden: z.boolean(),
})

// A palette slot is a small positive int; the UI owns how many there are.
const ColorSlotSchema = z.number().int().min(1).max(64).nullable()

export const SaveScopeCustomizationRequestSchema = z.object({
  colorSlot: ColorSlotSchema,
  customColor: z.string().max(7).nullable(),
  personaColorSlot: ColorSlotSchema,
  personaCustomColor: z.string().max(7).nullable(),
  personaImage: z.string().nullable(),
  workspaceImage: z.string().nullable(),
  groups: z.array(MenuGroupLayoutSchema).max(64),
  entries: z.array(MenuEntryLayoutSchema).max(128),
})

export const ScopeCustomizationResponseSchema = SaveScopeCustomizationRequestSchema.extend({
  scopeKey: z.string(),
})

export const TreeLayoutSchema = z.object({
  groups: z.array(z.string().min(1)).max(256),
  workspaces: z.record(z.string().min(1), z.array(z.string().min(1)).max(512)),
})

export const CustomizationsResponseSchema = z.object({
  scopes: z.array(ScopeCustomizationResponseSchema),
  treeLayout: TreeLayoutSchema.nullable(),
})
