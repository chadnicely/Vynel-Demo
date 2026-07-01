// Re-exports the row types from the `workspaces` domain schema for
// internal core-layer convenience. Consumer domains import `Workspace`
// from `@vynel/db/repositories/workspaces` (per the public surface).
// Per `docs/blueprints/workspaces/coding.md §3`.
//
// No `WorkspaceErrors` file — workspaces uses the generic `VynelError`
// taxonomy from `@vynel/core/errors` directly (NotFoundError,
// ConflictError, ValidationError). Per `.claude/rules/error-handling.md`
// "Taxonomy".

export type { Workspace, NewWorkspace, WorkspaceKind } from '@vynel/db/repositories/workspaces'
