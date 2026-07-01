// Public surface of the `workspaces` domain (core layer). Consumer
// domains import per-op via `@vynel/core/workspaces` per the `exports`
// map in `packages/core/package.json` (which maps `./<d>` →
// `./src/<d>/index.ts`). The root `packages/core/src/index.ts` stays
// empty — consumers use the per-domain subpath. Per
// `.claude/rules/structure-standard.md` "packages/core/src/".
//
// Per-op files (`create-workspace.ts`, `list-workspaces-for-user.ts`,
// `get-workspace-by-id.ts`, `update-workspace-metadata.ts`,
// `archive-workspace.ts`, `hard-delete-workspace.ts`,
// `make-default-workspace-parent-directory.ts`) are created by
// `/build-domain workspaces` TDD steps 9–15 — outside-in: write the
// failing test first, then drive the implementation down. Each will
// re-export its public surface from here.

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

export { createWorkspace } from './create-workspace.js'
export type { CreateWorkspaceInput, CreateWorkspaceDependencies } from './create-workspace.js'

// Manager persona naming (brain-tree Ch5) — the default-name picker + the resolver.
export { deriveDefaultManagerName, resolveManagerName } from './manager-name.js'

export { listWorkspacesForUser } from './list-workspaces-for-user.js'
export type { ListWorkspacesForUserInput } from './list-workspaces-for-user.js'

export { getWorkspaceById } from './get-workspace-by-id.js'
// Published cross-domain read surface (null-safe sibling of getWorkspaceById).
export { findWorkspaceById } from './find-workspace-by-id.js'

export { updateWorkspaceMetadata } from './update-workspace-metadata.js'
export type { UpdateWorkspaceMetadataInput } from './update-workspace-metadata.js'

export { makeDefaultWorkspaceParentDirectory } from './make-default-workspace-parent-directory.js'
export { sanitizeFolderName } from './sanitize-folder-name.js'
export { listChildDirectories } from './list-child-directories.js'
export type { DirectoryListing, DirectoryEntry } from './list-child-directories.js'

export { archiveWorkspace, unarchiveWorkspace } from './archive-workspace.js'

export { hardDeleteWorkspace } from './hard-delete-workspace.js'
export type {
  HardDeleteWorkspaceInput,
  HardDeleteWorkspaceDependencies,
} from './hard-delete-workspace.js'
