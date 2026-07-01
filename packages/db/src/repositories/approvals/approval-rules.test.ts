// Repository tests for `approval_rules`. Real SQLite via withTestDatabase.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '../../test-support/with-test-database.js'
import { insertUser } from '../users/users.js'
import { insertWorkspace } from '../workspaces/workspaces.js'
import {
  findApprovalRuleById,
  listEnabledApprovalRulesForWorkspace,
  listApprovalRulesForWorkspace,
  listSoftDeletedApprovalRulesBefore,
  insertApprovalRule,
  updateApprovalRule,
  softDeleteApprovalRule,
  hardDeleteApprovalRulesById,
  type NewApprovalRule,
} from './approval-rules.js'

function makeUser(id: string = randomUUID()) {
  const now = new Date()
  return {
    id,
    displayName: 'Test User',
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
    name: 'Acme',
    kind: 'small-business' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }
}

function makeApprovalRule(
  userId: string,
  workspaceId: string,
  overrides: Partial<NewApprovalRule> = {},
): NewApprovalRule {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    workspaceId,
    ruleKind: 'auto-approve-action-kind',
    description: 'Always allow write files in this workspace',
    matcher: { kind: 'auto-approve-action-kind', actionKind: 'file-write' },
    isEnabled: true,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('approval-rules repository', () => {
  describe('findApprovalRuleById', () => {
    it('returns null when soft-deleted', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const inserted = insertApprovalRule(db, makeApprovalRule(user.id, workspace.id))
        softDeleteApprovalRule(db, inserted.id)
        expect(findApprovalRuleById(db, inserted.id)).toBeNull()
      })
    })

    it('returns null when no row matches', async () => {
      await withTestDatabase((db) => {
        expect(findApprovalRuleById(db, 'nope')).toBeNull()
      })
    })

    it('returns the row when active', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const inserted = insertApprovalRule(db, makeApprovalRule(user.id, workspace.id))
        const found = findApprovalRuleById(db, inserted.id)
        expect(found?.id).toBe(inserted.id)
        expect(found?.matcher).toEqual({
          kind: 'auto-approve-action-kind',
          actionKind: 'file-write',
        })
      })
    })
  })

  describe('listEnabledApprovalRulesForWorkspace', () => {
    it('filters isEnabled=true AND deletedAt IS NULL', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const enabled = insertApprovalRule(db, makeApprovalRule(user.id, workspace.id))
        insertApprovalRule(db, makeApprovalRule(user.id, workspace.id, { isEnabled: false }))
        const willBeDeleted = insertApprovalRule(db, makeApprovalRule(user.id, workspace.id))
        softDeleteApprovalRule(db, willBeDeleted.id)
        const rows = listEnabledApprovalRulesForWorkspace(db, workspace.id)
        expect(rows.map((r) => r.id)).toEqual([enabled.id])
      })
    })
  })

  describe('listApprovalRulesForWorkspace', () => {
    it('filters deletedAt IS NULL (includes disabled)', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const enabled = insertApprovalRule(db, makeApprovalRule(user.id, workspace.id))
        const disabled = insertApprovalRule(
          db,
          makeApprovalRule(user.id, workspace.id, { isEnabled: false }),
        )
        const willBeDeleted = insertApprovalRule(db, makeApprovalRule(user.id, workspace.id))
        softDeleteApprovalRule(db, willBeDeleted.id)
        const rows = listApprovalRulesForWorkspace(db, workspace.id)
        const ids = rows.map((r) => r.id).sort()
        expect(ids).toEqual([enabled.id, disabled.id].sort())
      })
    })
  })

  describe('listSoftDeletedApprovalRulesBefore', () => {
    it('returns rows with deletedAt < cutoff (purge scan)', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const r1 = insertApprovalRule(db, makeApprovalRule(user.id, workspace.id))
        const r2 = insertApprovalRule(db, makeApprovalRule(user.id, workspace.id))
        const r3 = insertApprovalRule(db, makeApprovalRule(user.id, workspace.id))
        // Soft-delete r1 + r2 in the past; r3 stays active.
        const longAgo = new Date('2026-01-01T00:00:00Z')
        updateApprovalRule(db, r1.id, { deletedAt: longAgo, isEnabled: false })
        updateApprovalRule(db, r2.id, { deletedAt: longAgo, isEnabled: false })

        const cutoff = new Date('2026-02-01T00:00:00Z')
        const rows = listSoftDeletedApprovalRulesBefore(db, cutoff)
        const ids = rows.map((r) => r.id).sort()
        expect(ids).toEqual([r1.id, r2.id].sort())
        // r3 active — not in result
        expect(ids).not.toContain(r3.id)
      })
    })
  })

  describe('insertApprovalRule', () => {
    it('returns the inserted row', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const newRule = makeApprovalRule(user.id, workspace.id, {
          matcher: { kind: 'auto-approve-tool-name', toolName: 'Write' },
          ruleKind: 'auto-approve-tool-name',
        })
        const inserted = insertApprovalRule(db, newRule)
        expect(inserted.matcher).toEqual({ kind: 'auto-approve-tool-name', toolName: 'Write' })
        expect(inserted.ruleKind).toBe('auto-approve-tool-name')
      })
    })
  })

  describe('updateApprovalRule', () => {
    it('throws plain Error on missing id', async () => {
      await withTestDatabase((db) => {
        expect(() => updateApprovalRule(db, 'nonexistent', { isEnabled: false })).toThrow(
          /updateApprovalRule: no row/,
        )
      })
    })

    it('sets updatedAt to now (advances even when patch is empty-ish)', async () => {
      await withTestDatabase(async (db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const inserted = insertApprovalRule(db, makeApprovalRule(user.id, workspace.id))
        const before = inserted.updatedAt
        // Sleep 5ms to ensure the new timestamp differs.
        await new Promise((resolve) => setTimeout(resolve, 5))
        const updated = updateApprovalRule(db, inserted.id, { description: 'updated' })
        expect(updated.updatedAt.getTime()).toBeGreaterThan(before.getTime())
      })
    })
  })

  describe('softDeleteApprovalRule', () => {
    it('throws on second call — idempotency is upstream', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const inserted = insertApprovalRule(db, makeApprovalRule(user.id, workspace.id))
        softDeleteApprovalRule(db, inserted.id)
        // Second call — no active row matches the WHERE clause.
        expect(() => softDeleteApprovalRule(db, inserted.id)).toThrow(
          /softDeleteApprovalRule: no active row/,
        )
      })
    })

    it('sets isEnabled=false alongside deletedAt', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const inserted = insertApprovalRule(db, makeApprovalRule(user.id, workspace.id))
        const softDeleted = softDeleteApprovalRule(db, inserted.id)
        expect(softDeleted.isEnabled).toBe(false)
        expect(softDeleted.deletedAt).not.toBeNull()
      })
    })
  })

  describe('hardDeleteApprovalRulesById', () => {
    it('returns the deleted count', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const r1 = insertApprovalRule(db, makeApprovalRule(user.id, workspace.id))
        const r2 = insertApprovalRule(db, makeApprovalRule(user.id, workspace.id))
        const r3 = insertApprovalRule(db, makeApprovalRule(user.id, workspace.id))
        const deleted = hardDeleteApprovalRulesById(db, [r1.id, r2.id])
        expect(deleted).toBe(2)
        // r3 survives.
        const remaining = listApprovalRulesForWorkspace(db, workspace.id)
        expect(remaining).toHaveLength(1)
        expect(remaining[0]!.id).toBe(r3.id)
      })
    })

    it('no-ops on empty input', async () => {
      await withTestDatabase((db) => {
        expect(hardDeleteApprovalRulesById(db, [])).toBe(0)
      })
    })
  })
})
