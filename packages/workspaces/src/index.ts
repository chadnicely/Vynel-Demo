// Public surface of `@vynel/workspaces` — the workspaces domain's
// management logic (create / list / archive / hard-delete / rename +
// folder helpers). Surfaces (the api routes, and a future db-direct CLI)
// call these `(db, deps)` functions directly.
//
// WHY only logic lives here (not schema/repos): workspaces is a tenancy
// HUB — every feature FKs to the `workspaces` table. Its schema +
// repositories therefore stay in the kernel (`@vynel/db/schema/workspaces`,
// `@vynel/db/repositories/workspaces`); moving them into this package would
// force every feature to import `@vynel/workspaces` (cross-feature coupling
// we forbid). Leaf features (knowledge, …) own their schema; hubs don't.

export type {
  Workspace,
  NewWorkspace,
  WorkspaceKind,
  WorkspaceStatusKind,
  WorkspaceGroup,
  NewWorkspaceGroup,
} from './workspaces-types.js'

export {
  WORKSPACE_CREATED_EVENT,
  WORKSPACE_ARCHIVED_EVENT,
  WORKSPACE_DELETED_EVENT,
  WORKSPACE_GROUP_CREATED_EVENT,
  WORKSPACE_GROUP_DELETED_EVENT,
  WORKSPACE_STATUS_SET_EVENT,
} from './workspaces-events.js'

export type {
  WorkspaceCreatedPayload,
  WorkspaceArchivedPayload,
  WorkspaceDeletedPayload,
  WorkspaceGroupCreatedPayload,
  WorkspaceGroupDeletedPayload,
  WorkspaceStatusSetPayload,
} from './workspaces-events.js'

// Status vocabulary (workspace redesign Arc 5b).
export { setWorkspaceStatus } from './status/set-workspace-status.js'
export type { SetWorkspaceStatusInput } from './status/set-workspace-status.js'

// Menu-tree folders (workspace redesign Arc 2b).
export { createWorkspaceGroup } from './groups/create-workspace-group.js'
export type { CreateWorkspaceGroupInput } from './groups/create-workspace-group.js'
export { listWorkspaceGroups } from './groups/list-workspace-groups.js'
export { renameWorkspaceGroup } from './groups/rename-workspace-group.js'
export type { RenameWorkspaceGroupInput } from './groups/rename-workspace-group.js'
export { deleteWorkspaceGroup } from './groups/delete-workspace-group.js'
export type { DeleteWorkspaceGroupInput } from './groups/delete-workspace-group.js'
export { setWorkspaceGroup } from './groups/set-workspace-group.js'
export type { SetWorkspaceGroupInput } from './groups/set-workspace-group.js'

export { createWorkspace } from './lifecycle/create-workspace.js'
export type { CreateWorkspaceInput, CreateWorkspaceDependencies } from './lifecycle/create-workspace.js'

// Manager persona naming (brain-tree Ch5) — the default-name picker + the resolver.
export { formatManagerLabel, hasDistinctManagerName, resolveManagerName } from './manager-name.js'

export { listWorkspacesForUser } from './lifecycle/list-workspaces-for-user.js'
export type { ListWorkspacesForUserInput } from './lifecycle/list-workspaces-for-user.js'

export { getWorkspaceById } from './lifecycle/get-workspace-by-id.js'
// Published cross-domain read surface (null-safe sibling of getWorkspaceById).
export { findWorkspaceById } from './lifecycle/find-workspace-by-id.js'

export { updateWorkspaceMetadata } from './lifecycle/update-workspace-metadata.js'
export type { UpdateWorkspaceMetadataInput } from './lifecycle/update-workspace-metadata.js'

export { makeDefaultWorkspaceParentDirectory } from './directory/make-default-workspace-parent-directory.js'
export { sanitizeFolderName } from './directory/sanitize-folder-name.js'
export { listChildDirectories } from './directory/list-child-directories.js'
export { createChildDirectory } from './directory/create-child-directory.js'
export type { DirectoryListing, DirectoryEntry } from './directory/list-child-directories.js'
export type { DriveRoot, DriveKind } from './directory/list-drive-roots.js'
export type { KnownPlace, KnownPlaceKind } from './directory/list-known-places.js'

export { archiveWorkspace, unarchiveWorkspace } from './lifecycle/archive-workspace.js'

export { hardDeleteWorkspace } from './lifecycle/hard-delete-workspace.js'
export type {
  HardDeleteWorkspaceInput,
  HardDeleteWorkspaceDependencies,
} from './lifecycle/hard-delete-workspace.js'
