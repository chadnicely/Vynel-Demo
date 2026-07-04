// `approval_requests` table for the `approvals` domain — one row per
// approval the user has been asked to make. Append-only audit data; pure
// retention (no `deletedAt`) — `purgeOldApprovalRequests` worker
// hard-deletes resolved rows older than 90 days (D14).
//
// Spec: `docs/blueprints/approvals/blueprint.md §3.1`.
//
// Cross-domain seam: `sessionId` / `parentMessageId` / `toolUseId` are
// plain `text()` (no FK to chat tables) — D13. Chat's outbox consumer
// mirrors approval decisions onto `chat_tool_calls.approvalStatus` via
// the lifecycle outbox events. See
// [[cross-domain-loose-ref-with-outbox-mirror]].
//
// `providerApprovalId` (renamed from `approvalRequestId` per D18) is the
// provider-supplied identifier the SDK passes in
// `ApprovalRequestedEvent.approvalRequestId`. Indexed `uniqueIndex` for
// the hot route lookup. The row's own `id` is a Vynel UUID supplied at
// the core layer via `crypto.randomUUID()`.
//
// `actionKind` is derived at insert via `deriveActionKind(toolName)` and
// stored verbatim — D8 (never re-derived on read).
//
// `autoApprovedByRuleId` is a nullable FK to `approval_rules.id` (NULL =
// manually approved by the user, not by a saved rule). Uses plain
// `text().references(...)` since `id()` from the dialect helpers is
// NOT NULL by contract. SET NULL on rule deletion preserves the audit
// row.
//
// Phase 1 SYNC discipline applies.

import { table, id, text, timestamp, integer, json, index, uniqueIndex } from '@vynel/db/dialect'
import { users } from '@vynel/db/schema/users'
import { workspaces } from '@vynel/db/schema/workspaces'
import { approvalRules } from './approval-rules.js'

export type ActionKind =
  | 'email-send'
  | 'file-write'
  | 'file-edit'
  | 'file-delete'
  | 'calendar-write'
  | 'shell-command'
  | 'external-action'
  | 'memory-write'
  | 'other'

export type ApprovalRequestStatus = 'pending' | 'resolved'

export type ApprovalResolutionKind = 'approved' | 'denied' | 'timed-out' | 'cancelled'

export const approvalRequests = table(
  'approval_requests',
  {
    id: id().primaryKey(),
    providerApprovalId: text().notNull(),
    userId: id().references(() => users.id, { onDelete: 'cascade' }),
    // Nullable: a workspace card carries its workspace; a global-root (brain) card
    // has NONE (mirrors `primary_sessions.workspaceId`). Persisting the brain's cards
    // — rather than dropping them — is what makes them reachable in the user's global
    // approval queue. Uses `text().references(...)` since `id()` is NOT NULL by contract.
    workspaceId: text().references(() => workspaces.id, { onDelete: 'cascade' }),
    sessionId: text().notNull(),
    parentMessageId: text().notNull(),
    toolUseId: text().notNull(),
    toolName: text().notNull(),
    actionKind: text().$type<ActionKind>().notNull(),
    toolInput: json<unknown>().notNull(),
    status: text().$type<ApprovalRequestStatus>().notNull(),
    resolutionKind: text().$type<ApprovalResolutionKind>(),
    resolutionReason: text(),
    resolutionUpdatedInput: json<unknown>(),
    autoApprovedByRuleId: text().references(() => approvalRules.id, { onDelete: 'set null' }),
    timeoutMs: integer().notNull(),
    requestedAt: timestamp().notNull(),
    resolvedAt: timestamp(),
  },
  (t) => ({
    providerApprovalIdIdx: uniqueIndex('idx_approval_requests_provider_approval_id').on(
      t.providerApprovalId,
    ),
    sessionStatusIdx: index('idx_approval_requests_session_status').on(t.sessionId, t.status),
    workspaceRequestedAtIdx: index('idx_approval_requests_workspace_requested_at').on(
      t.workspaceId,
      t.requestedAt,
    ),
    userIdIdx: index('idx_approval_requests_user').on(t.userId),
    statusRequestedAtIdx: index('idx_approval_requests_status_requested_at').on(
      t.status,
      t.requestedAt,
    ),
    toolUseIdIdx: index('idx_approval_requests_tool_use_id').on(t.toolUseId),
  }),
)

export type ApprovalRequest = typeof approvalRequests.$inferSelect
export type NewApprovalRequest = typeof approvalRequests.$inferInsert
