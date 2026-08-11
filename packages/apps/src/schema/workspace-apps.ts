// `workspace_apps` table for the `apps` domain — one row per runnable app a
// workspace knows about (a monorepo's api + web dev servers, a build watch…).
// The ROW is the durable registration; whether it is RUNNING lives only in
// the in-memory process supervisor (a daemon restart stops everything via
// stopAll — no "running" column to go stale).
//
// WORKSPACE-SCOPED (NOT NULL workspaceId — a deliberate narrowing of the
// house nullable-scope default): an app needs a working directory, and only
// workspaces have one (docs/module-notes/apps.md). `cwdRelative` is a subpath
// under `workspaces.path` ('' = the workspace root); the supervisor
// containment-checks the resolved path at spawn — the row never stores an
// absolute path.

import { table, id, text, timestamp, integer, index } from '@vynel/db/dialect'
import { users } from '@vynel/db/schema/users'
import { workspaces } from '@vynel/db/schema/workspaces'

export const workspaceApps = table(
  'workspace_apps',
  {
    id: id().primaryKey(),
    userId: id().references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: id().references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text().notNull(), // plain language ("Web app"); unique per workspace, case-insensitive
    command: text().notNull(), // the shell command, e.g. "pnpm --filter web dev"
    cwdRelative: text().notNull(), // '' = workspace root
    // The app's env file, relative to its OWN folder (`cwdRelative`) —
    // Claude points at the real file when it registers the app; '.env' is
    // the sensible default for everything else. The env editor
    // (`env/app-env-file.ts`) parses and rewrites THIS file directly — the
    // file the app actually loads is the single source of truth, no DB copy.
    envFileRelative: text().notNull().default('.env'),
    port: integer(), // nullable — powers the "open in browser" link
    createdAt: timestamp().notNull(),
    updatedAt: timestamp().notNull(),
  },
  (t) => ({
    workspaceIdx: index('idx_workspace_apps_workspace').on(t.workspaceId),
  }),
)

export type WorkspaceApp = typeof workspaceApps.$inferSelect
export type NewWorkspaceApp = typeof workspaceApps.$inferInsert
