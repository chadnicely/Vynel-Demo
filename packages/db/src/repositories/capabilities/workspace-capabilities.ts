// Functional repository for the `workspace_capabilities` table — the
// capability-enable spine. `db` first arg, sync returns (Phase 1, workspaces
// D19). `find*` returns null; mutating fns encode the `userId` tenant filter in
// the WHERE clause (data-standard.md "Tenant isolation"; a missing filter is
// review-blocking). Typed throws happen at the core boundary
// (error-handling.md "Layering"); repos throw plain `Error` only on
// internal-invariant violations (empty `.returning()`).
// Spec: `.claude/plans/capability-platform.md` (Gate 1).

import { and, eq } from 'drizzle-orm'
import type { Database } from '../../client.js'
import {
  workspaceCapabilities,
  type WorkspaceCapabilityRow,
  type NewWorkspaceCapabilityRow,
} from '../../schema/capabilities/workspace-capabilities.js'

export type {
  WorkspaceCapabilityRow,
  NewWorkspaceCapabilityRow,
} from '../../schema/capabilities/workspace-capabilities.js'

export type FindWorkspaceCapabilityInput = {
  workspaceId: string
  capabilityId: string
}

export function findWorkspaceCapability(
  db: Database,
  input: FindWorkspaceCapabilityInput,
): WorkspaceCapabilityRow | null {
  const [row] = db
    .select()
    .from(workspaceCapabilities)
    .where(
      and(
        eq(workspaceCapabilities.workspaceId, input.workspaceId),
        eq(workspaceCapabilities.capabilityId, input.capabilityId),
      ),
    )
    .limit(1)
    .all()
  return row ?? null
}

export function listWorkspaceCapabilities(
  db: Database,
  workspaceId: string,
): WorkspaceCapabilityRow[] {
  return db
    .select()
    .from(workspaceCapabilities)
    .where(eq(workspaceCapabilities.workspaceId, workspaceId))
    .all()
}

export function insertWorkspaceCapability(
  db: Database,
  newRow: NewWorkspaceCapabilityRow,
): WorkspaceCapabilityRow {
  const [inserted] = db.insert(workspaceCapabilities).values(newRow).returning().all()
  if (!inserted) {
    throw new Error('insertWorkspaceCapability: no row returned')
  }
  return inserted
}

export function updateWorkspaceCapabilityEnabled(
  db: Database,
  workspaceCapabilityId: string,
  userId: string,
  isEnabled: boolean,
): WorkspaceCapabilityRow | null {
  const [updated] = db
    .update(workspaceCapabilities)
    .set({ isEnabled, updatedAt: new Date() })
    .where(
      and(
        eq(workspaceCapabilities.id, workspaceCapabilityId),
        eq(workspaceCapabilities.userId, userId),
      ),
    )
    .returning()
    .all()
  return updated ?? null
}
