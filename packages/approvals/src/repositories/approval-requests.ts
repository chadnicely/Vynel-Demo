// Functional repository for the `approval_requests` table. `db` is the first
// argument (per `docs/foundation.md §2 row 3` + `.claude/rules/
// coding-standard.md`). Spec: `docs/blueprints/approvals/blueprint.md §5.1`.
//
// Phase 1 SYNC return values — required by the better-sqlite3 transaction
// contract per `.claude/memory/decisions/phase-1-sync-transactions.md`.
//
// All reads filter on workspaceId / sessionId / userId at the caller level
// — there is no soft-delete column on this table (D14: pure retention,
// not soft-delete). The `purgeOldApprovalRequests` worker hard-deletes
// rows older than 90 days.

import { and, asc, desc, eq, lt, or, sql } from 'drizzle-orm'
import type { Database } from '@vynel/db'
import {
  approvalRequests,
  type ApprovalRequest,
  type NewApprovalRequest,
} from '../schema/approval-requests.js'

export type {
  ApprovalRequest,
  NewApprovalRequest,
  ActionKind,
  ApprovalRequestStatus,
  ApprovalResolutionKind,
} from '../schema/approval-requests.js'

// Defensive caps on listApprovalRequestsForWorkspace per coding-standard.md
// "Structure / patterns" — every list* that scales with tenant data is
// capped at the repo layer too (the Zod schema also clamps at the HTTP
// boundary).
const DEFAULT_LIST_LIMIT = 50
const MAX_LIST_LIMIT = 200

export function findApprovalRequestById(db: Database, requestId: string): ApprovalRequest | null {
  const [row] = db
    .select()
    .from(approvalRequests)
    .where(eq(approvalRequests.id, requestId))
    .limit(1)
    .all()
  return row ?? null
}

export function findApprovalRequestByProviderApprovalId(
  db: Database,
  providerApprovalId: string,
): ApprovalRequest | null {
  const [row] = db
    .select()
    .from(approvalRequests)
    .where(eq(approvalRequests.providerApprovalId, providerApprovalId))
    .limit(1)
    .all()
  return row ?? null
}

export function listPendingApprovalRequestsForSession(
  db: Database,
  sessionId: string,
): ApprovalRequest[] {
  return db
    .select()
    .from(approvalRequests)
    .where(and(eq(approvalRequests.sessionId, sessionId), eq(approvalRequests.status, 'pending')))
    .orderBy(desc(approvalRequests.requestedAt))
    .all()
}

export type ListApprovalRequestsForWorkspaceOptions = {
  limit?: number
  cursor?: { requestedAt: Date; id: string }
}

export function listApprovalRequestsForWorkspace(
  db: Database,
  workspaceId: string,
  options: ListApprovalRequestsForWorkspaceOptions = {},
): ApprovalRequest[] {
  const limit = Math.min(options.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)
  const filters = [eq(approvalRequests.workspaceId, workspaceId)]
  if (options.cursor) {
    // Keyset cursor on (requestedAt DESC, id DESC). The compound predicate
    // is: requestedAt < cursor.requestedAt OR (requestedAt = cursor AND
    // id < cursor.id). Drizzle's `sql` template emits dialect-portable
    // SQL — same shape works in Postgres in Phase 2.
    filters.push(
      or(
        lt(approvalRequests.requestedAt, options.cursor.requestedAt),
        and(
          eq(approvalRequests.requestedAt, options.cursor.requestedAt),
          lt(approvalRequests.id, options.cursor.id),
        ),
      )!,
    )
  }
  return db
    .select()
    .from(approvalRequests)
    .where(and(...filters))
    .orderBy(desc(approvalRequests.requestedAt), desc(approvalRequests.id))
    .limit(limit)
    .all()
}

export function listStalePendingApprovalRequests(
  db: Database,
  options: { staleBefore: Date; limit?: number },
): ApprovalRequest[] {
  return db
    .select()
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.status, 'pending'),
        lt(approvalRequests.requestedAt, options.staleBefore),
      ),
    )
    .orderBy(asc(approvalRequests.requestedAt))
    .limit(options.limit ?? 500)
    .all()
}

export function insertApprovalRequest(
  db: Database,
  newRequest: NewApprovalRequest,
): ApprovalRequest {
  const [inserted] = db.insert(approvalRequests).values(newRequest).returning().all()
  if (!inserted) throw new Error('insertApprovalRequest: no row returned')
  return inserted
}

export function updateApprovalRequest(
  db: Database,
  requestId: string,
  patch: Partial<
    Omit<
      ApprovalRequest,
      | 'id'
      | 'userId'
      | 'workspaceId'
      | 'sessionId'
      | 'parentMessageId'
      | 'toolUseId'
      | 'requestedAt'
    >
  >,
): ApprovalRequest {
  const [updated] = db
    .update(approvalRequests)
    .set(patch)
    .where(eq(approvalRequests.id, requestId))
    .returning()
    .all()
  if (!updated) throw new Error(`updateApprovalRequest: no row for id ${requestId}`)
  return updated
}

export function hardDeleteApprovalRequestsRequestedBefore(db: Database, cutoff: Date): number {
  const deleted = db
    .delete(approvalRequests)
    .where(lt(approvalRequests.requestedAt, cutoff))
    .returning()
    .all()
  return deleted.length
}
