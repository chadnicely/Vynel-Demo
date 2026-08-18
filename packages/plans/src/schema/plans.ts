// `plans` table for the `plans` domain — one row per plan on the user's or a
// workspace's date-wise plan list. A plan is "what is planned for this day",
// one level above the task list; its work items are `tasks` rows carrying a
// loose `planId` ref back here. Has NO `deletedAt`: `deletePlan` hard-deletes —
// a plan row is not irrecoverable user content (docs/module-notes/plans.md).
//
// Schema files import from `@vynel/db/dialect` ONLY — never from
// `drizzle-orm/*-core`. `userId` is the tenant boundary; `workspaceId` is the
// domain scope — nullable, NULL = global (no workspace); mirrors
// `tasks.workspaceId`. `sessionId` is a LOOSE `text()` cross-domain ref (NO FK).
// `planDate` is a text `YYYY-MM-DD` day, not a timestamp — calendar semantics
// sort correctly as text and dodge timezone drift. Phase 1 SYNC repo discipline.

import { table, id, text, timestamp, index } from '@vynel/db/dialect'
import { users } from '@vynel/db/schema/users'
import { workspaces } from '@vynel/db/schema/workspaces'

// The tasks status vocabulary, deliberately shared — one status language
// across both lists.
export type PlanStatus = 'open' | 'in-progress' | 'done'

// Who put the plan on the list — the assistant (via its MCP tools) or the
// user (via the UI/CLI). Drives the "Claude / you" chip in the UI.
export type PlanSource = 'assistant' | 'user'

export const plans = table(
  'plans',
  {
    id: id().primaryKey(),
    userId: id().references(() => users.id, { onDelete: 'cascade' }),
    // Nullable: NULL = GLOBAL scope (a user-level plan with no workspace);
    // a non-null value scopes the plan to that workspace. Uses
    // `text().references(...)` since `id()` is NOT NULL by contract.
    workspaceId: text().references(() => workspaces.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    detail: text(), // optional longer description
    // The date-wise key: the calendar day (`YYYY-MM-DD`) this plan belongs to.
    planDate: text().notNull(),
    status: text().$type<PlanStatus>().notNull(),
    source: text().$type<PlanSource>().notNull(),
    // Loose cross-domain ref — the chat session whose turn created the plan
    // (NOT a FK).
    sessionId: text(),
    // Loose cross-feature ref — the task this plan EXECUTES (`tasks` is a
    // sibling leaf; NO FK). The execution-flow direction: a task's plan hangs
    // off the task (docs/module-notes/task-execution.md); the older
    // `tasks.planId` day-planning relation stays for the date-wise list.
    taskId: text(),
    completedAt: timestamp(), // stamped on → 'done'; cleared when reopened
    createdAt: timestamp().notNull(),
    updatedAt: timestamp().notNull(),
  },
  (t) => ({
    userWorkspaceIdx: index('idx_plans_user_workspace').on(t.userId, t.workspaceId),
    userDateIdx: index('idx_plans_user_date').on(t.userId, t.planDate),
    userStatusIdx: index('idx_plans_user_status').on(t.userId, t.status),
  }),
)

export type Plan = typeof plans.$inferSelect
export type NewPlan = typeof plans.$inferInsert
