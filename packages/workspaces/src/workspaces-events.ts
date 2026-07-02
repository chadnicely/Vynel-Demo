// Outbox event types + payload interfaces for the `workspaces` domain.
// Three events published from day one per D14 — workspaces ships the
// outbox infrastructure as well.
// Spec: `docs/blueprints/workspaces/blueprint.md §6.7` + §14.
//
// Event constants + payload type bodies filled by `/build-domain
// workspaces` TDD step 8.

import type { WorkspaceKind } from '@vynel/db/repositories/workspaces'

export const WORKSPACE_CREATED_EVENT = 'workspace.created' as const
export const WORKSPACE_ARCHIVED_EVENT = 'workspace.archived' as const
export const WORKSPACE_DELETED_EVENT = 'workspace.deleted' as const

export type WorkspaceCreatedPayload = {
  workspaceId: string
  userId: string
  kind: WorkspaceKind
  name: string
  path: string
  createdAt: string
}

export type WorkspaceArchivedPayload = {
  workspaceId: string
  userId: string
  archivedAt: string
}

// Unarchive deliberately publishes no event (D14 — deliberate asymmetry).
// No Phase 1 consumer needs a "back-in-the-list" signal.

export type WorkspaceDeletedPayload = {
  workspaceId: string
  userId: string
  path: string
  deleteFilesFromDisk: boolean
  deletedAt: string
}
