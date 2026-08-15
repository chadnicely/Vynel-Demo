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
// Menu-tree folders (workspace redesign Arc 2b) — created/deleted pair only,
// mirroring the workspace vocabulary. Rename + membership moves are
// event-less metadata updates (the updateWorkspaceMetadata precedent).
export const WORKSPACE_GROUP_CREATED_EVENT = 'workspace-group.created' as const
export const WORKSPACE_GROUP_DELETED_EVENT = 'workspace-group.deleted' as const
// Status vocabulary (redesign Arc 5b) — published when the assistant SETS a
// workspace status (completed / problem / needs_input). Supersession by a
// later turn is a read-time derivation, deliberately event-less.
export const WORKSPACE_STATUS_SET_EVENT = 'workspace.status-set' as const

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

export type WorkspaceStatusSetPayload = {
  workspaceId: string
  userId: string
  status: 'completed' | 'problem' | 'needs_input'
  note: string | null
  setAt: string
}

export type WorkspaceGroupCreatedPayload = {
  groupId: string
  userId: string
  name: string
  createdAt: string
}

export type WorkspaceGroupDeletedPayload = {
  groupId: string
  userId: string
  name: string
  /** How many workspaces the delete detached back to the tree root. */
  detachedWorkspaceCount: number
  deletedAt: string
}
