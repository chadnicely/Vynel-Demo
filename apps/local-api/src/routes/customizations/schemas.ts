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
  // The core caps at 512 KB after the prefix check; this just bounds the parse.
  personaImage: z.string().max(600 * 1024).nullable(),
  workspaceImage: z.string().max(600 * 1024).nullable(),
  groups: z.array(MenuGroupLayoutSchema).max(64),
  entries: z.array(MenuEntryLayoutSchema).max(128),
})

export const ScopeCustomizationResponseSchema = SaveScopeCustomizationRequestSchema.extend({
  scopeKey: z.string(),
})

const TreeIdSchema = z.string().min(1).max(128)
export const TreeLayoutSchema = z.object({
  groups: z.array(TreeIdSchema).max(256),
  workspaces: z.record(TreeIdSchema, z.array(TreeIdSchema).max(512)),
})

export const CustomizationsResponseSchema = z.object({
  scopes: z.array(ScopeCustomizationResponseSchema),
  treeLayout: TreeLayoutSchema.nullable(),
})
