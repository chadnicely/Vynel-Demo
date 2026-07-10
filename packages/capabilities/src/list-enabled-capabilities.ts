// `listEnabledCapabilities` — the enabled first-party capabilities for a
// workspace, resolved through the catalog. The session-build consumes this each
// turn to compose the agent's tools + instructions + context. Sync (Phase 1 DB
// read, no transaction). Enabled ids not in the catalog (future marketplace
// plugins) are skipped here — Phase A composes first-party only.
//
// Enablement resolves CATALOG-first: no row → the capability's
// `defaultEnabled`; a row (the toggle panel writes one either way) is an
// explicit override. Nothing seeds rows at workspace creation, so a
// row-required default left every capability silently off on fresh installs.

import type { Database } from '@vynel/db'
import { listWorkspaceCapabilities } from '@vynel/db/repositories/capabilities'
import { CAPABILITY_CATALOG } from './catalog.js'
import type { Capability } from './capabilities-types.js'

export function listEnabledCapabilities(db: Database, workspaceId: string): Capability[] {
  const rows = listWorkspaceCapabilities(db, workspaceId)
  const isEnabledById = new Map(rows.map((row) => [row.capabilityId, row.isEnabled]))
  return CAPABILITY_CATALOG.filter(
    (capability) => isEnabledById.get(capability.id) ?? capability.defaultEnabled,
  )
}
