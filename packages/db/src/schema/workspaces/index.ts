// Barrel for the `workspaces` domain schema. Re-exports every table file
// so consumers can `import { workspaces } from '@vynel/db/schema/workspaces'`
// per the `exports` map in `packages/db/package.json`. Per
// `.claude/rules/structure-standard.md` "packages/db/src/schema/".

export * from './workspaces.js'
export * from './workspace-groups.js'
