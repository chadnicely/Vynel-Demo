// Functional repository for the `approval_rules` table. `db` is the first
// argument. Spec: `docs/blueprints/approvals/blueprint.md §5.2`.
//
// Soft-delete + 30d retention + `purgeDeletedApprovalRules` worker (D14).
// All reads filter `isNull(deletedAt)` — a missing filter is review-
// blocking (per data-standard.md).
//
// Phase 1 SYNC return values.

import { and, eq, inArray, isNull, lt } from 'drizzle-orm'
import type { Database } from '../../client.js'
import {
  approvalRules,
  type ApprovalRule,
  type NewApprovalRule,
} from '../../schema/approvals/approval-rules.js'

export type {
  ApprovalRule,
  NewApprovalRule,
  ApprovalRuleKind,
  ApprovalRuleMatcher,
} from '../../schema/approvals/approval-rules.js'

export function findApprovalRuleById(db: Database, ruleId: string): ApprovalRule | null {
  const [row] = db
    .select()
    .from(approvalRules)
    .where(and(eq(approvalRules.id, ruleId), isNull(approvalRules.deletedAt)))
    .limit(1)
    .all()
  return row ?? null
}

export function listEnabledApprovalRulesForWorkspace(
  db: Database,
  workspaceId: string,
): ApprovalRule[] {
  return db
    .select()
    .from(approvalRules)
    .where(
      and(
        eq(approvalRules.workspaceId, workspaceId),
        eq(approvalRules.isEnabled, true),
        isNull(approvalRules.deletedAt),
      ),
    )
    .all()
}

export function listApprovalRulesForWorkspace(db: Database, workspaceId: string): ApprovalRule[] {
  return db
    .select()
    .from(approvalRules)
    .where(and(eq(approvalRules.workspaceId, workspaceId), isNull(approvalRules.deletedAt)))
    .all()
}

export function listSoftDeletedApprovalRulesBefore(db: Database, cutoff: Date): ApprovalRule[] {
  return db.select().from(approvalRules).where(lt(approvalRules.deletedAt, cutoff)).all()
}

export function insertApprovalRule(db: Database, newRule: NewApprovalRule): ApprovalRule {
  const [inserted] = db.insert(approvalRules).values(newRule).returning().all()
  if (!inserted) throw new Error('insertApprovalRule: no row returned')
  return inserted
}

export function updateApprovalRule(
  db: Database,
  ruleId: string,
  patch: Partial<Omit<ApprovalRule, 'id' | 'userId' | 'workspaceId' | 'createdAt'>>,
): ApprovalRule {
  const [updated] = db
    .update(approvalRules)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(approvalRules.id, ruleId))
    .returning()
    .all()
  if (!updated) throw new Error(`updateApprovalRule: no row for id ${ruleId}`)
  return updated
}

export function softDeleteApprovalRule(db: Database, ruleId: string): ApprovalRule {
  const now = new Date()
  const [updated] = db
    .update(approvalRules)
    .set({ deletedAt: now, isEnabled: false, updatedAt: now })
    .where(and(eq(approvalRules.id, ruleId), isNull(approvalRules.deletedAt)))
    .returning()
    .all()
  if (!updated) throw new Error(`softDeleteApprovalRule: no active row for id ${ruleId}`)
  return updated
}

export function hardDeleteApprovalRulesById(db: Database, ruleIds: readonly string[]): number {
  if (ruleIds.length === 0) return 0
  const deleted = db
    .delete(approvalRules)
    .where(inArray(approvalRules.id, ruleIds as string[]))
    .returning()
    .all()
  return deleted.length
}
