// The tool-policy vocabulary — one home for the shapes the catalog, the
// resolver, the routes, and the admin matrix share.

import type { ToolCardClass } from '../schema/tool-policies.js'

export type { ToolCardClass } from '../schema/tool-policies.js'

/** The consumer kinds a turn can run as — WHERE a tool may attach. Mirrors
 *  the composition sites (the session-tool-catalog owns which descriptors
 *  each kind composes; per-tool surface overrides refine within that). */
export const SESSION_SURFACE_KINDS = [
  'global-interactive',
  'global-channel',
  'workspace-interactive',
  'workspace-background',
  'delegated-workspace',
  'delegated-global',
  'spawned',
  'agent',
  'schedule',
] as const

export type SessionSurfaceKind = (typeof SESSION_SURFACE_KINDS)[number]

/** One tool's DECLARED defaults, assembled at the app edge from the
 *  descriptors (`toolNames` + gates) and the generated registry's surface
 *  arrays. `db`-free input to the resolver — packages never import apps. */
export type ToolCatalogEntry = {
  readonly toolName: string
  readonly serverName: string
  readonly surfaces: readonly SessionSurfaceKind[]
  readonly cardClass: ToolCardClass
  readonly featureKey?: string
  readonly capabilityId?: string
}

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
