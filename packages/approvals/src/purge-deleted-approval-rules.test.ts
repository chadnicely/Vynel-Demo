import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  insertApprovalRule,
  updateApprovalRule,
  listApprovalRulesForWorkspace,
  type NewApprovalRule,
} from '@vynel/db/repositories/approvals'
import { purgeDeletedApprovalRules } from './purge-deleted-approval-rules.js'

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
    description: 'desc',
    matcher: { kind: 'auto-approve-action-kind', actionKind: 'file-write' },
    isEnabled: true,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

describe('purgeDeletedApprovalRules', () => {
  it('hard-deletes rules soft-deleted more than 30 days ago', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))

      const now = new Date('2026-05-24T00:00:00Z')
      const oldDeleted = insertApprovalRule(db, makeRule(user.id, workspace.id))
      // Soft-deleted 40 days ago — should be purged.
      updateApprovalRule(db, oldDeleted.id, {
        deletedAt: new Date('2026-04-14T00:00:00Z'),
        isEnabled: false,
      })

      const recentDeleted = insertApprovalRule(db, makeRule(user.id, workspace.id))
      // Soft-deleted 20 days ago — should survive.
      updateApprovalRule(db, recentDeleted.id, {
        deletedAt: new Date('2026-05-04T00:00:00Z'),
        isEnabled: false,
      })

      // Active rule — should survive.
      insertApprovalRule(db, makeRule(user.id, workspace.id))

      const result = purgeDeletedApprovalRules(db, { now: () => now })

      expect(result.purgedCount).toBe(1)
      // 1 active survives via listApprovalRulesForWorkspace (filters deletedAt IS NULL).
      const activeSurvivors = listApprovalRulesForWorkspace(db, workspace.id)
      expect(activeSurvivors).toHaveLength(1)
    })
  })

  it('no-ops when no rows are soft-deleted', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      insertApprovalRule(db, makeRule(user.id, workspace.id))

      const result = purgeDeletedApprovalRules(db, { now: () => new Date() })
      expect(result.purgedCount).toBe(0)
    })
  })
})
