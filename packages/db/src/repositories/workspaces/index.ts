// Barrel for the `workspaces` domain repositories. Re-exports the
// workspaces repo file so consumers can `import { findWorkspaceById }
// from '@vynel/db/repositories/workspaces'` per the `exports` map in
// `packages/db/package.json`.

export * from './workspaces.js'
export * from './workspace-groups.js'
