// The `workspaces` table — one row per workspace, every row carries
// `userId` per the locked Phase 1 → Phase 2 multi-user-ready rule.
// Spec: `docs/blueprints/workspaces/blueprint.md §3.1`.
//
// Phase 1 SYNC discipline applies — see
// `.claude/memory/decisions/phase-1-sync-transactions.md`.
//
// No `deletedAt` column — carve-out from data-standard "Soft delete"
// per decisions.md D13. The recoverable hide affordance is `isArchived`;
// the destructive exit is `hardDeleteWorkspace` gated by
// `deleteFilesFromDisk`. Do NOT add `deletedAt` without re-opening D13.

import { desc } from 'drizzle-orm'
import { table, id, text, timestamp, boolean, index } from '@vynel/db/dialect'
import { users } from '../users/users.js'

export type WorkspaceKind = 'small-business' | 'personal' | 'project' | 'custom'

// The assistant-SET workspace status (redesign Arc 5b, "one status one
// colour"): `completed` = every task done, set before the next message;
// `problem` = the assistant flags it stuck; `needs_input` = a conclusion
// needs the user. Rows are facts, never cleared by a write — a status is
// SUPERSEDED by any turn that starts after `statusSetAt` (the effective
// status derives at read time from this + turn liveness + approvals/asks).
export type WorkspaceStatusKind = 'completed' | 'problem' | 'needs_input'

export const workspaces = table(
  'workspaces',
  {
    id: id().primaryKey(),
    userId: id().references(() => users.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    // The workspace manager's persona name (brain-tree Ch5) — "Mark is handling vynel".
    // Nullable: create stores the workspace name as the default; a null row resolves to
    // the workspace name at read time (`resolveManagerName`). Renameable by the user. Additive.
    managerName: text(),
    kind: text().$type<WorkspaceKind>().notNull(),
    path: text().notNull(),
    isArchived: boolean().notNull(),
    // Continue-mode toggle (agent-base Slice 2). When true (default), this
    // workspace's landing conversation follows the root + swaps invisibly before
    // the context fills; when false, classic per-topic sessions (no root, no
    // swap). NOT NULL DEFAULT true — purely additive; pre-existing workspaces
    // backfill to enabled (the product thesis is default-on).
    continueEnabled: boolean().notNull().default(true),
    // Menu-tree folder membership (workspace redesign Arc 2b) — a LOOSE
    // in-leaf ref to `workspace_groups.id` (`tasks.planId` precedent):
    // nullable, no DB FK; deleting a group detaches members inside its
    // transaction. Null = at the tree root.
    groupId: text(),
    // Assistant-set status trio — all nullable; null = nothing set. The
    // note is the assistant's one-line why ("All 5 tasks shipped and
    // verified"), surfaced on the rail card + chat header.
    status: text().$type<WorkspaceStatusKind>(),
    statusNote: text(),
    statusSetAt: timestamp(),
    // When the human finished "Finish setting up" for this project — the
    // repository, the AI account, the env file (Chad, 2026-08-24).
    //
    // NULL = it still needs setting up, which is exactly what the sidebar's
    // NEEDS SETUP section lists. A project pulled in from disk starts null and
    // stays there until the dialog's Done; a project Vynel SCAFFOLDS stamps it
    // at birth — it built and configured it, so there is nothing left to ask.
    //
    // One-way and idempotent, and additive: rows written before this column
    // read as "needs setup", so no backfill beyond the ADD COLUMN.
    setupCompletedAt: timestamp(),
    createdAt: timestamp().notNull(),
    updatedAt: timestamp().notNull(),
    lastAccessedAt: timestamp().notNull(),
  },
  (t) => ({
    userIdIdx: index('idx_workspaces_user_id').on(t.userId),
    userIdArchivedIdx: index('idx_workspaces_user_id_archived').on(t.userId, t.isArchived),
    lastAccessedAtIdx: index('idx_workspaces_last_accessed_at').on(desc(t.lastAccessedAt)),
  }),
)

export type Workspace = typeof workspaces.$inferSelect
export type NewWorkspace = typeof workspaces.$inferInsert
