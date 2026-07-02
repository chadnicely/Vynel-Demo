// `setCapabilityEnabled` — enable or disable a capability for a workspace.
// Upserts the per-workspace enable row (insert on first toggle, update after).
// Sync (Phase 1 DB write; a single insert OR update, so no transaction). The
// `userId` tenant filter is enforced by the repo update. The catalog is NOT
// validated here (marketplace ids are open text) — the route validates against
// the catalog at the boundary.

import { randomUUID } from 'node:crypto'
import type { Database } from '@vynel/db'
import {
  findWorkspaceCapability,
  insertWorkspaceCapability,
  updateWorkspaceCapabilityEnabled,
  type WorkspaceCapabilityRow,
} from '@vynel/db/repositories/capabilities'

export type SetCapabilityEnabledInput = {
  userId: string
  workspaceId: string
  capabilityId: string
  isEnabled: boolean
}

export function setCapabilityEnabled(
  db: Database,
  input: SetCapabilityEnabledInput,
): WorkspaceCapabilityRow {
  const existing = findWorkspaceCapability(db, {
    workspaceId: input.workspaceId,
    capabilityId: input.capabilityId,
  })
  if (existing) {
    const updated = updateWorkspaceCapabilityEnabled(db, existing.id, input.userId, input.isEnabled)
    if (!updated) {
      // Row exists but the tenant filter rejected the update — the workspace
      // isn't owned by this user. Shouldn't happen behind the workspace-resolver
      // middleware, but fail loud rather than silently no-op.
      throw new Error('setCapabilityEnabled: update rejected by tenant filter')
    }
    return updated
  }
  const now = new Date()
  return insertWorkspaceCapability(db, {
    id: randomUUID(),
    userId: input.userId,
    workspaceId: input.workspaceId,
    capabilityId: input.capabilityId,
    isEnabled: input.isEnabled,
    createdAt: now,
    updatedAt: now,
  })
}
