// `listCapabilityStatusForWorkspace` — every first-party catalog capability
// paired with whether it's enabled for the given workspace. Powers the
// capabilities panel (show all capabilities as toggles, on or off). Sync
// (Phase 1 DB read).

import type { Database } from '@vynel/db'
import { listWorkspaceCapabilities } from '@vynel/db/repositories/capabilities'
import { CAPABILITY_CATALOG } from './catalog.js'
import type { Capability } from './capabilities-types.js'

export type CapabilityStatus = {
  capability: Capability
  isEnabled: boolean
}

export function listCapabilityStatusForWorkspace(
  db: Database,
  workspaceId: string,
): CapabilityStatus[] {
  const rows = listWorkspaceCapabilities(db, workspaceId)
  const isEnabledById = new Map(rows.map((row) => [row.capabilityId, row.isEnabled]))
  return CAPABILITY_CATALOG.map((capability) => ({
    capability,
    // No row → the catalog default (a row is an explicit toggle override) —
    // the same resolution listEnabledCapabilities uses, so the panel never
    // shows "off" while the session composes the capability in.
    isEnabled: isEnabledById.get(capability.id) ?? capability.defaultEnabled,
  }))
}
