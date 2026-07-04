// Tests for `softDeleteApprovalRule`. No provider mock — this op is
// pure DB.
//
// Coverage:
// - NotFoundError when the rule doesn't exist.
// - NotFoundError when ownership doesn't match (no enumeration).
// - Happy path: deletedAt set, isEnabled=false.
// - Already-deleted: NotFoundError (repo's idempotency upstream).

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { NotFoundError } from '@vynel/errors'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  insertApprovalRule,
  findApprovalRuleById,
  type NewApprovalRule,
} from '../repositories/index.js'
import { softDeleteApprovalRule } from './soft-delete-approval-rule.js'

function makeUser() {
  const now = new Date()
  return {
    id: randomUUID(),
    displayName: 'T',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  }
}

function makeWorkspace(userId: string) {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    name: 'WS',
    kind: 'personal' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }
}

function makeRule(userId: string, workspaceId: string): NewApprovalRule {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    workspaceId,
    ruleKind: 'auto-approve-action-kind',
    description: 'Always allow file-write',
    matcher: { kind: 'auto-approve-action-kind', actionKind: 'file-write' },
    isEnabled: true,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

describe('softDeleteApprovalRule', () => {
  it('throws NotFoundError when the rule does not exist', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      expect(() =>
        softDeleteApprovalRule(db, {
          ruleId: 'nonexistent',
          userId: user.id,
          workspaceId: workspace.id,
        }),
      ).toThrow(NotFoundError)
    })
  })

  it('throws NotFoundError when ownership does not match (no enumeration)', async () => {
    await withTestDatabase((db) => {
      const owner = insertUser(db, makeUser())
      const other = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(owner.id))
      const rule = insertApprovalRule(db, makeRule(owner.id, workspace.id))
      expect(() =>
        softDeleteApprovalRule(db, {
          ruleId: rule.id,
          userId: other.id,
          workspaceId: workspace.id,
        }),
      ).toThrow(NotFoundError)
      // Rule still active.
      expect(findApprovalRuleById(db, rule.id)?.deletedAt).toBeNull()
    })
  })

  it('soft-deletes: deletedAt set, isEnabled=false', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const rule = insertApprovalRule(db, makeRule(user.id, workspace.id))
      const deleted = softDeleteApprovalRule(db, {
        ruleId: rule.id,
        userId: user.id,
        workspaceId: workspace.id,
      })
      expect(deleted.deletedAt).not.toBeNull()
      expect(deleted.isEnabled).toBe(false)
      // findApprovalRuleById filters isNull(deletedAt) — soft-deleted is gone.
      expect(findApprovalRuleById(db, rule.id)).toBeNull()
    })
  })

  it('second call on a soft-deleted rule throws NotFoundError', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const rule = insertApprovalRule(db, makeRule(user.id, workspace.id))
      softDeleteApprovalRule(db, {
        ruleId: rule.id,
        userId: user.id,
        workspaceId: workspace.id,
      })
      expect(() =>
        softDeleteApprovalRule(db, {
          ruleId: rule.id,
          userId: user.id,
          workspaceId: workspace.id,
        }),
      ).toThrow(NotFoundError)
    })
  })
})
