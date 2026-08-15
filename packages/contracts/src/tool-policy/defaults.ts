// The operator tool-policy defaults — the wire shapes shared by the hub's
// /admin/tool-policy routes, the cloud-admin portal, the desktop release
// build (which downloads the map export), and the engine's boot validation
// of the baked file. Same nullable-inherit semantics as the product's
// per-user `tool_policies` overrides: null = inherit the declared catalog
// default; 'none' on a gate field = ungate.

import { z } from "zod";
import { SessionSurfaceKindSchema, ToolCardClassSchema } from "./catalog.js";

export const TOOL_NAME_PATTERN = /^mcp__[a-z0-9-]+__[a-z0-9_]+$/;

export const ToolPolicyDefaultFieldsSchema = z.object({
  enabled: z.boolean().nullable(),
  cardClass: ToolCardClassSchema.nullable(),
  surfaces: z.array(SessionSurfaceKindSchema).nullable(),
  // 'none' = ungate; otherwise a HubFeatureKey. Membership in the live
  // vocabulary is the hub's semantic check, not the wire's.
  featureKey: z.string().min(1).max(60).nullable(),
  capabilityId: z.string().min(1).max(60).nullable(),
});

export type ToolPolicyDefaultFields = z.infer<
  typeof ToolPolicyDefaultFieldsSchema
>;

export const ToolPolicyDefaultSchema = ToolPolicyDefaultFieldsSchema.extend({
  toolName: z.string().regex(TOOL_NAME_PATTERN),
});

export type ToolPolicyDefault = z.infer<typeof ToolPolicyDefaultSchema>;

/** The downloadable map: what a desktop release bakes in. `version` is the
 *  sha256 of the canonical defaults JSON — two identical maps always carry
 *  the same version, so a rebuild against an unchanged map is a no-op diff. */
export const ToolPolicyMapExportSchema = z.object({
  version: z.string().regex(/^[0-9a-f]{64}$/),
  generatedAt: z.string().datetime(),
  defaults: z.array(ToolPolicyDefaultSchema),
});

export type ToolPolicyMapExport = z.infer<typeof ToolPolicyMapExportSchema>;
