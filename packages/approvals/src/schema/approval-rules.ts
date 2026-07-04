// `approval_rules` table for the `approvals` domain — user-saved
// "remember this rule" decisions that auto-approve future similar
// actions. Soft-delete + 30-day retention + `purgeDeletedApprovalRules`
// worker (D14).
//
// Spec: `docs/blueprints/approvals/blueprint.md §3.2`.
//
// Phase 1 ships TWO rule kinds: `auto-approve-action-kind` (matches by
// derived category) and `auto-approve-tool-name` (matches by exact tool
// name). The shallow-equality-with-wildcards variant + its UI lands in
// Phase 1.5 (D6 revised + D17).
//
// `matcher` uses `json<T>()` — typed payload, parsed by Drizzle's `mode:
// 'json'`. The rule engine consumes the structured value directly.
//
// Phase 1 SYNC discipline applies.

import { table, id, text, timestamp, boolean, json, index } from '@vynel/db/dialect'
import { users } from '@vynel/db/schema/users'
import { workspaces } from '@vynel/db/schema/workspaces'
import type { ActionKind } from './approval-requests.js'

export type ApprovalRuleKind = 'auto-approve-action-kind' | 'auto-approve-tool-name'

export type ApprovalRuleMatcher =
  | { kind: 'auto-approve-action-kind'; actionKind: ActionKind }
  | { kind: 'auto-approve-tool-name'; toolName: string }

export const approvalRules = table(
  'approval_rules',
  {
    id: id().primaryKey(),
    userId: id().references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: id().references(() => workspaces.id, { onDelete: 'cascade' }),
    ruleKind: text().$type<ApprovalRuleKind>().notNull(),
    description: text().notNull(),
    matcher: json<ApprovalRuleMatcher>().notNull(),
    isEnabled: boolean().notNull(),
    deletedAt: timestamp(),
    createdAt: timestamp().notNull(),
    updatedAt: timestamp().notNull(),
  },
  (t) => ({
    workspaceEnabledIdx: index('idx_approval_rules_workspace_enabled').on(
      t.workspaceId,
      t.isEnabled,
    ),
    workspaceDeletedAtIdx: index('idx_approval_rules_workspace_deleted_at').on(
      t.workspaceId,
      t.deletedAt,
    ),
    userIdIdx: index('idx_approval_rules_user').on(t.userId),
  }),
)

export type ApprovalRule = typeof approvalRules.$inferSelect
export type NewApprovalRule = typeof approvalRules.$inferInsert
