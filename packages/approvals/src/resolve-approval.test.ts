// Tests for `resolveApproval`. Same `vi.mock('@vynel/providers')`
// pattern as record-approval-request.test.ts.
//
// Coverage:
// - NotFoundError when providerApprovalId doesn't exist.
// - NotFoundError when ownership doesn't match (no enumeration leak).
// - ConflictError when the request is already resolved.
// - Approve path: provider called BEFORE row update; row resolved with
//   `approved`; outbox approval.user-resolved event emitted.
// - Approve with rememberRule: rule row + approval.rule-created event.
// - Approve with updatedInput: persisted in resolutionUpdatedInput.
// - Deny path: reason stored; provider called with denied + reason.
// - Provider throw: row stays pending (ordering invariant).

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { ConflictError, NotFoundError } from '@vynel/errors'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  findApprovalRequestByProviderApprovalId,
  insertApprovalRequest,
  listApprovalRulesForWorkspace,
  type NewApprovalRequest,
} from './repositories/index.js'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'

const respondToApprovalRequestSpy = vi.fn().mockResolvedValue(undefined)

vi.mock('@vynel/providers', async () => {
  const actual = await vi.importActual<typeof import('@vynel/providers')>('@vynel/providers')
  return {
    ...actual,
    resolveAiAgentProvider: () => ({
      respondToApprovalRequest: respondToApprovalRequestSpy,
    }),
  }
})

import { resolveApproval } from './resolve-approval.js'

beforeEach(() => {
  respondToApprovalRequestSpy.mockReset()
  respondToApprovalRequestSpy.mockResolvedValue(undefined)
})

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
function makePendingRow(
  userId: string,
  workspaceId: string | null,
  providerApprovalId: string,
): NewApprovalRequest {
  return {
    id: randomUUID(),
    providerApprovalId,
    userId,
    workspaceId,
    sessionId: 'session-1',
    parentMessageId: 'message-1',
    toolUseId: 'tool-1',
    toolName: 'Write',
    actionKind: 'file-write',
    toolInput: { path: '/tmp/foo' },
    status: 'pending',
    resolutionKind: null,
    resolutionReason: null,
    resolutionUpdatedInput: null,
    autoApprovedByRuleId: null,
    timeoutMs: 300_000,
    requestedAt: new Date(),
    resolvedAt: null,
  }
}

describe('resolveApproval', () => {
  it('throws NotFoundError when the providerApprovalId does not exist', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      await expect(
        resolveApproval(db, {
          providerApprovalId: 'nonexistent',
          userId: user.id,
          providerId: 'claude',
          decision: { kind: 'denied', reason: 'no' },
        }),
      ).rejects.toBeInstanceOf(NotFoundError)
      expect(respondToApprovalRequestSpy).not.toHaveBeenCalled()
    })
  })

  it('throws NotFoundError when ownership does not match (no enumeration)', async () => {
    await withTestDatabase(async (db) => {
      const owner = insertUser(db, makeUser())
      const other = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(owner.id))
      insertApprovalRequest(db, makePendingRow(owner.id, workspace.id, 'prov-1'))
      // Other user calls — should look like 404.
      await expect(
        resolveApproval(db, {
          providerApprovalId: 'prov-1',
          userId: other.id,
          providerId: 'claude',
          decision: { kind: 'approved' },
        }),
      ).rejects.toBeInstanceOf(NotFoundError)
      expect(respondToApprovalRequestSpy).not.toHaveBeenCalled()
    })
  })

  it('throws ConflictError on a double-resolve attempt', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      insertApprovalRequest(db, makePendingRow(user.id, workspace.id, 'prov-double'))
      await resolveApproval(db, {
        providerApprovalId: 'prov-double',
        userId: user.id,
        providerId: 'claude',
        decision: { kind: 'approved' },
      })
      await expect(
        resolveApproval(db, {
          providerApprovalId: 'prov-double',
          userId: user.id,
          providerId: 'claude',
          decision: { kind: 'denied', reason: 'no' },
        }),
      ).rejects.toBeInstanceOf(ConflictError)
    })
  })

  it('approves: calls provider with kind=approved; updates row; emits approval.user-resolved', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      insertApprovalRequest(db, makePendingRow(user.id, workspace.id, 'prov-yes'))

      const updated = await resolveApproval(db, {
        providerApprovalId: 'prov-yes',
        userId: user.id,
        providerId: 'claude',
        decision: { kind: 'approved' },
      })
      expect(updated.status).toBe('resolved')
      expect(updated.resolutionKind).toBe('approved')

      expect(respondToApprovalRequestSpy).toHaveBeenCalledTimes(1)
      expect(respondToApprovalRequestSpy).toHaveBeenCalledWith('prov-yes', { kind: 'approved' })

      const events = listOutboxEventsByType(db, 'approval.user-resolved')
      expect(events).toHaveLength(1)
    })
  })

  it('approve+rememberRule: saves the rule + emits approval.rule-created in the same tx', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      insertApprovalRequest(db, makePendingRow(user.id, workspace.id, 'prov-remember'))

      const updated = await resolveApproval(db, {
        providerApprovalId: 'prov-remember',
        userId: user.id,
        providerId: 'claude',
        decision: {
          kind: 'approved',
          rememberRule: { kind: 'auto-approve-action-kind' },
        },
      })
      expect(updated.resolutionKind).toBe('approved')

      const rules = listApprovalRulesForWorkspace(db, workspace.id)
      expect(rules).toHaveLength(1)
      expect(rules[0]!.ruleKind).toBe('auto-approve-action-kind')
      expect(rules[0]!.matcher).toEqual({
        kind: 'auto-approve-action-kind',
        actionKind: 'file-write',
      })

      expect(listOutboxEventsByType(db, 'approval.rule-created')).toHaveLength(1)
    })
  })

  it('approve+updatedInput: persists the user-edited input in resolutionUpdatedInput; toolInput unchanged', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      insertApprovalRequest(db, makePendingRow(user.id, workspace.id, 'prov-edit'))

      const updated = await resolveApproval(db, {
        providerApprovalId: 'prov-edit',
        userId: user.id,
        providerId: 'claude',
        decision: {
          kind: 'approved',
          updatedInput: { path: '/tmp/edited' },
        },
      })
      expect(updated.toolInput).toEqual({ path: '/tmp/foo' }) // original preserved
      expect(updated.resolutionUpdatedInput).toEqual({ path: '/tmp/edited' })

      // Provider receives the updatedInput.
      expect(respondToApprovalRequestSpy).toHaveBeenCalledWith('prov-edit', {
        kind: 'approved',
        updatedInput: { path: '/tmp/edited' },
      })
    })
  })

  it('denies: stores the reason; provider called with denied+reason', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      insertApprovalRequest(db, makePendingRow(user.id, workspace.id, 'prov-no'))

      const updated = await resolveApproval(db, {
        providerApprovalId: 'prov-no',
        userId: user.id,
        providerId: 'claude',
        decision: { kind: 'denied', reason: 'not safe' },
      })
      expect(updated.resolutionKind).toBe('denied')
      expect(updated.resolutionReason).toBe('not safe')
      expect(respondToApprovalRequestSpy).toHaveBeenCalledWith('prov-no', {
        kind: 'denied',
        reason: 'not safe',
      })
    })
  })

  it('provider throw: row stays pending (provider-call-before-row-update invariant)', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      insertApprovalRequest(db, makePendingRow(user.id, workspace.id, 'prov-crash'))

      respondToApprovalRequestSpy.mockRejectedValueOnce(new Error('provider crashed'))

      await expect(
        resolveApproval(db, {
          providerApprovalId: 'prov-crash',
          userId: user.id,
          providerId: 'claude',
          decision: { kind: 'approved' },
        }),
      ).rejects.toThrow('provider crashed')

      const reloaded = findApprovalRequestByProviderApprovalId(db, 'prov-crash')
      expect(reloaded?.status).toBe('pending')
      expect(listOutboxEventsByType(db, 'approval.user-resolved')).toHaveLength(0)
    })
  })

  it('resolves a workspace-less global-root (brain) card — userId-only tenant guard', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      // A brain card: null workspace. The whole point of the global queue is that the
      // user can ANSWER it (not just have it time out) — this is the resolve half.
      insertApprovalRequest(db, makePendingRow(user.id, null, 'prov-brain'))

      const updated = await resolveApproval(db, {
        providerApprovalId: 'prov-brain',
        userId: user.id,
        providerId: 'claude',
        decision: { kind: 'approved' },
      })

      expect(updated.status).toBe('resolved')
      expect(updated.workspaceId).toBeNull()
      expect(respondToApprovalRequestSpy).toHaveBeenCalledWith('prov-brain', { kind: 'approved' })
      expect(listOutboxEventsByType(db, 'approval.user-resolved')).toHaveLength(1)
    })
  })
})
