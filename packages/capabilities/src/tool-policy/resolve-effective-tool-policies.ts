// `resolveEffectiveToolPolicies` — merges the DECLARED defaults (the catalog
// the app edge assembles from descriptors + the generated registry) with the
// admin's `tool_policies` override rows. NULL columns inherit; 'none' on the
// gate columns UNGATES; an unknown override row (a tool that left the
// registry) is ignored rather than resurrected — the catalog is the roster.

import type { Database } from '@vynel/db'
import { listToolPolicies } from '../repositories/tool-policies.js'
import {
  SESSION_SURFACE_KINDS,
  type EffectiveToolPolicies,
  type EffectiveToolPolicy,
  type SessionSurfaceKind,
  type ToolCatalogEntry,
} from './tool-policy-types.js'

/** 'none' on featureKey/capabilityId means "ungate" (NULL means inherit). */
export const TOOL_POLICY_UNGATED = 'none'

function toSurfaces(stored: string[] | null): readonly SessionSurfaceKind[] | null {
  if (stored === null) return null
  // Tolerate rows written before a surface kind was renamed — keep only the
  // kinds that still exist so a stale row narrows, never crashes, a turn.
  return stored.filter((kind): kind is SessionSurfaceKind =>
    (SESSION_SURFACE_KINDS as readonly string[]).includes(kind),
  )
}

/** PRECONDITION on `catalog`: one entry per toolName. Several vynel tools
 *  (get_chat_session, send_message, set_todos, search_chat_messages) exist in
 *  more than one generated surface array under the SAME name — the assembler
 *  must pre-merge their surface membership into one entry, or the later entry
 *  silently wins here. */
export function resolveEffectiveToolPolicies(
  db: Database,
  input: { userId: string; catalog: readonly ToolCatalogEntry[] },
): EffectiveToolPolicies {
  const overrides = new Map(
    listToolPolicies(db, input.userId).map((row) => [row.toolName, row] as const),
  )

  const effective = new Map<string, EffectiveToolPolicy>()
  for (const entry of input.catalog) {
    const override = overrides.get(entry.toolName)
    const surfacesOverride = override ? toSurfaces(override.surfacesJson) : null
    const featureKey =
      override?.featureKey === TOOL_POLICY_UNGATED
        ? undefined
        : (override?.featureKey ?? entry.featureKey)
    const capabilityId =
      override?.capabilityId === TOOL_POLICY_UNGATED
        ? undefined
        : (override?.capabilityId ?? entry.capabilityId)
    effective.set(entry.toolName, {
      toolName: entry.toolName,
      serverName: entry.serverName,
      enabled: override?.enabled ?? true,
      surfaces: surfacesOverride ?? entry.surfaces,
      cardClass: override?.cardClass ?? entry.cardClass,
      ...(featureKey !== undefined ? { featureKey } : {}),
      ...(capabilityId !== undefined ? { capabilityId } : {}),
      hasOverride: override !== undefined,
    })
  }
  return effective
}
