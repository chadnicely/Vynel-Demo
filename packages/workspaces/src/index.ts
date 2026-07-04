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

export type { Workspace, NewWorkspace, WorkspaceKind } from './workspaces-types.js'

export {
  WORKSPACE_CREATED_EVENT,
  WORKSPACE_ARCHIVED_EVENT,
  WORKSPACE_DELETED_EVENT,
} from './workspaces-events.js'

export type {
  WorkspaceCreatedPayload,
  WorkspaceArchivedPayload,
  WorkspaceDeletedPayload,
} from './workspaces-events.js'

export { createWorkspace } from './lifecycle/create-workspace.js'
export type { CreateWorkspaceInput, CreateWorkspaceDependencies } from './lifecycle/create-workspace.js'

// Manager persona naming (brain-tree Ch5) — the default-name picker + the resolver.
export { deriveDefaultManagerName, resolveManagerName } from './manager-name.js'

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
export type { DirectoryListing, DirectoryEntry } from './directory/list-child-directories.js'

export { archiveWorkspace, unarchiveWorkspace } from './lifecycle/archive-workspace.js'

export { hardDeleteWorkspace } from './lifecycle/hard-delete-workspace.js'
export type {
  HardDeleteWorkspaceInput,
  HardDeleteWorkspaceDependencies,
} from './lifecycle/hard-delete-workspace.js'
