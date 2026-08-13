// The `workspace_groups` table — user-created folders that organize the
// workspace tree (menu-mode navigation; workspace redesign Arc 2b,
// `docs/module-notes/workspace-redesign.md`). Every row carries `userId`
// per the locked Phase 1 → Phase 2 multi-user-ready rule.
//
// Membership lives on `workspaces.groupId` as a LOOSE in-leaf ref
// (`tasks.planId` precedent) — deleting a group detaches its members inside
// the delete op's transaction, so no DB-level FK is needed and the
// migration stays a plain CREATE TABLE + ADD COLUMN.

import { table, id, text, timestamp, index } from '@vynel/db/dialect'
import { users } from '../users/users.js'

export const workspaceGroups = table(
  'workspace_groups',
  {
    id: id().primaryKey(),
    userId: id().references(() => users.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    createdAt: timestamp().notNull(),
    updatedAt: timestamp().notNull(),
  },
  (t) => ({
    userIdIdx: index('idx_workspace_groups_user_id').on(t.userId),
  }),
)

export type WorkspaceGroup = typeof workspaceGroups.$inferSelect
export type NewWorkspaceGroup = typeof workspaceGroups.$inferInsert
