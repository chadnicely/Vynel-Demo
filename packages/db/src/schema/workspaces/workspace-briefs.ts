// One brief per workspace — the new-workspace wizard's approved plan, kept in
// the DB (Kafi, 2026-08-23: never a PLAN.md in the folder). `answers` and
// `plan` are opaque JSON to the kernel: their shapes live in
// `@vynel/contracts/workspaces/workspace-brief` and the `workspaces` leaf is
// the typed boundary (`toWorkspaceBrief`). Same domain as `workspaces`, so the
// FK is allowed; deleting the workspace takes its brief with it.

import { table, id, text, timestamp, json, uniqueIndex } from '@vynel/db/dialect'
import { users } from '../users/users.js'
import { workspaces } from './workspaces.js'

export const workspaceBriefs = table(
  'workspace_briefs',
  {
    id: id().primaryKey(),
    userId: id().references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: id().references(() => workspaces.id, { onDelete: 'cascade' }),
    answers: json().notNull(),
    plan: json().notNull(),
    // The text the user sent as the first message — built once by
    // `buildWorkspaceBrief`, stored so the session can re-read exactly it.
    brief: text().notNull(),
    createdAt: timestamp().notNull(),
  },
  (t) => ({
    workspaceIdx: uniqueIndex('idx_workspace_briefs_workspace_id').on(t.workspaceId),
  }),
)

export type WorkspaceBriefRow = typeof workspaceBriefs.$inferSelect
export type NewWorkspaceBriefRow = typeof workspaceBriefs.$inferInsert
