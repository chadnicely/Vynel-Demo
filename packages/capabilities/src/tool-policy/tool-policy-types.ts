// The tool-policy vocabulary — one home for the shapes the catalog, the
// resolver, the routes, and the admin matrix share. The wire-shared half
// (kinds + the catalog entry) lives in `@vynel/contracts/tool-policy` so the
// hub and the cloud-admin portal speak the same words; re-exported here so
// capabilities stays the product-side import door.

import type { SessionSurfaceKind, ToolCardClass } from '@vynel/contracts/tool-policy/catalog'

export type {
  SessionSurfaceKind,
  ToolCardClass,
  ToolCatalogEntry,
} from '@vynel/contracts/tool-policy/catalog'
export { SESSION_SURFACE_KINDS, TOOL_CARD_CLASSES } from '@vynel/contracts/tool-policy/catalog'

/** The resolved, admin-merged policy for one tool. `hasOverride` marks that
 *  an override row exists — the admin matrix renders "customized". */
export type EffectiveToolPolicy = {
  readonly toolName: string
  readonly serverName: string
  readonly enabled: boolean
  readonly surfaces: readonly SessionSurfaceKind[]
  readonly cardClass: ToolCardClass
  /** undefined = ungated (declared none, or override 'none'). */
  readonly featureKey?: string
  readonly capabilityId?: string
  readonly hasOverride: boolean
}

export type EffectiveToolPolicies = ReadonlyMap<string, EffectiveToolPolicy>
