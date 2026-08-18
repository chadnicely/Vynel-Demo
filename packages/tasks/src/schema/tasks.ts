// `tasks` table for the `tasks` domain — one row per task on the user's or a
// workspace's list. The agent SDK has no built-in task feature; Vynel's task
// list is how Claude's multi-step work becomes visible ("what is it doing /
// what has it done"). Has NO `deletedAt`: `deleteTask` hard-deletes — a task
// row is not irrecoverable user content (docs/module-notes/tasks.md).
//
// Schema files import from `@vynel/db/dialect` ONLY — never from
// `drizzle-orm/*-core`. `userId` is the tenant boundary; `workspaceId` is the
// domain scope — nullable, NULL = global (no workspace); mirrors
// `schedules.workspaceId`. `sessionId` is a LOOSE `text()` cross-domain ref
// (NO FK to chat sessions); a deleted session leaves a dangling id here
// harmlessly. Indexes via the `index()` helper. Phase 1 SYNC repo discipline.

import { table, id, text, timestamp, index } from '@vynel/db/dialect'
import { users } from '@vynel/db/schema/users'
import { workspaces } from '@vynel/db/schema/workspaces'

export type TaskStatus = 'open' | 'in-progress' | 'done'

// Who put the task on the list — the assistant (via its MCP tools) or the
// user (via the UI/CLI). Drives the "Claude / you" chip in the UI.
export type TaskSource = 'assistant' | 'user'

export const tasks = table(
  'tasks',
  {
    id: id().primaryKey(),
    userId: id().references(() => users.id, { onDelete: 'cascade' }),
    // Nullable: NULL = GLOBAL scope (a user-level task with no workspace);
    // a non-null value scopes the task to that workspace. Uses
    // `text().references(...)` since `id()` is NOT NULL by contract.
    workspaceId: text().references(() => workspaces.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    detail: text(), // optional longer description
    status: text().$type<TaskStatus>().notNull(),
    source: text().$type<TaskSource>().notNull(),
    // Loose cross-domain ref — the chat session whose turn created the task
    // (data for a future task→session deep-link; NOT a FK).
    sessionId: text(),
    // Loose cross-feature ref — the plan this task belongs to (`plans` is a
    // sibling leaf; NO FK by invariant). A deleted plan leaves a dangling id
    // here harmlessly, like sessionId.
    planId: text(),
    // Loose cross-domain ref — the session WORKING the task (vs `sessionId`,
    // the session that CREATED it). Server-stamped from the turn-session
    // header on pickup, never model-supplied; data-ready for the future
    // workspace→session task feeding (docs/module-notes/task-execution.md).
    assignedSessionId: text(),
    completedAt: timestamp(), // stamped on → 'done'; cleared when reopened
    createdAt: timestamp().notNull(),
    updatedAt: timestamp().notNull(),
  },
  (t) => ({
    userWorkspaceIdx: index('idx_tasks_user_workspace').on(t.userId, t.workspaceId),
    userStatusIdx: index('idx_tasks_user_status').on(t.userId, t.status),
  }),
)

export type Task = typeof tasks.$inferSelect
export type NewTask = typeof tasks.$inferInsert
