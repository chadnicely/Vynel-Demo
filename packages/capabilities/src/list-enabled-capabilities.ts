// `listEnabledCapabilities` — the enabled first-party capabilities for a
// workspace, resolved through the catalog. The session-build consumes this each
// turn to compose the agent's tools + instructions + context. Sync (Phase 1 DB
// read, no transaction). Enabled ids not in the catalog (future marketplace
// plugins) are skipped here — Phase A composes first-party only.

import type { Database } from '@vynel/db'
import { listWorkspaceCapabilities } from '@vynel/db/repositories/capabilities'
import { findCapabilityById } from './catalog.js'
import type { Capability } from './capabilities-types.js'

export function listEnabledCapabilities(db: Database, workspaceId: string): Capability[] {
  return listWorkspaceCapabilities(db, workspaceId)
    .filter((row) => row.isEnabled)
    .map((row) => findCapabilityById(row.capabilityId))
    .filter((capability): capability is Capability => capability !== null)
}
