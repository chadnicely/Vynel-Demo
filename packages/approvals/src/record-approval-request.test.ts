// Tests for `recordApprovalRequest`. Provider mocked at the module
// boundary via `vi.mock('@vynel/providers')`.
//
// Coverage: pending path (no rule match), auto-approve path (rule
// match + provider unblock + row update + outbox emit), provider call
// happens AFTER the initial insert (the ordering invariant the chat
// stream depends on).

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { findApprovalRequestById, insertApprovalRule } from '@vynel/db/repositories/approvals'
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

import { recordApprovalRequest } from './record-approval-request.js'

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

describe('recordApprovalRequest', () => {
  it('returns kind=pending when no matching rule exists; persists the audit row + approval.requested event', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))

      const result = await recordApprovalRequest(db, {
        providerApprovalId: 'prov-abc',
        userId: user.id,
        workspaceId: workspace.id,
        sessionId: 'session-1',
        parentMessageId: 'message-1',
        toolUseId: 'tool-1',
        providerId: 'claude',
        toolName: 'Write',
        toolInput: { path: '/tmp/foo' },
      })

      expect(result.kind).toBe('pending')
      expect(result.request.actionKind).toBe('file-write')
      expect(result.request.status).toBe('pending')

      // Provider NOT called on pending path.
      expect(respondToApprovalRequestSpy).not.toHaveBeenCalled()

      // approval.requested emitted in the same tx as the insert.
      const events = listOutboxEventsByType(db, 'approval.requested')
      expect(events).toHaveLength(1)
      expect((events[0]!.payload as { providerApprovalId: string }).providerApprovalId).toBe(
        'prov-abc',
      )
    })
  })

  it('auto-approves when a matching auto-approve-action-kind rule exists; calls provider then updates the row', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))

      // Pre-seed a matching rule.
      const rule = insertApprovalRule(db, {
        id: randomUUID(),
        userId: user.id,
        workspaceId: workspace.id,
        ruleKind: 'auto-approve-action-kind',
        description: 'Always allow file-write',
        matcher: { kind: 'auto-approve-action-kind', actionKind: 'file-write' },
        isEnabled: true,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      const result = await recordApprovalRequest(db, {
        providerApprovalId: 'prov-auto',
        userId: user.id,
        workspaceId: workspace.id,
        sessionId: 'session-1',
        parentMessageId: 'message-1',
        toolUseId: 'tool-1',
        providerId: 'claude',
        toolName: 'Write',
        toolInput: { path: '/tmp/foo' },
      })

      expect(result.kind).toBe('auto-approved')
      if (result.kind !== 'auto-approved') throw new Error('unreachable')
      expect(result.matchedRuleId).toBe(rule.id)
      expect(result.request.status).toBe('resolved')
      expect(result.request.resolutionKind).toBe('approved')
      expect(result.request.autoApprovedByRuleId).toBe(rule.id)
      expect(result.request.resolvedAt).not.toBeNull()

      // Provider called exactly once with kind=approved.
      expect(respondToApprovalRequestSpy).toHaveBeenCalledTimes(1)
      expect(respondToApprovalRequestSpy).toHaveBeenCalledWith('prov-auto', { kind: 'approved' })

      // Both events emitted in distinct transactions.
      expect(listOutboxEventsByType(db, 'approval.requested')).toHaveLength(1)
      expect(listOutboxEventsByType(db, 'approval.auto-resolved')).toHaveLength(1)
    })
  })

  it('skips disabled rules (does NOT auto-approve)', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))

      insertApprovalRule(db, {
        id: randomUUID(),
        userId: user.id,
        workspaceId: workspace.id,
        ruleKind: 'auto-approve-action-kind',
        description: 'Disabled',
        matcher: { kind: 'auto-approve-action-kind', actionKind: 'file-write' },
        isEnabled: false,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      const result = await recordApprovalRequest(db, {
        providerApprovalId: 'prov-skip',
        userId: user.id,
        workspaceId: workspace.id,
        sessionId: 'session-1',
        parentMessageId: 'message-1',
        toolUseId: 'tool-1',
        providerId: 'claude',
        toolName: 'Write',
        toolInput: { path: '/tmp/foo' },
      })

      expect(result.kind).toBe('pending')
      expect(respondToApprovalRequestSpy).not.toHaveBeenCalled()
    })
  })

  it('the audit row exists in the DB even if the provider call subsequently fails on auto-approve', async () => {
    // Provider throws → recordApprovalRequest rejects, but the initial
    // insert (Tx 1) has already committed. The row stays pending; the
    // recovery worker will eventually time it out. This is the ordering
    // invariant: provider call BEFORE row update.
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))

      insertApprovalRule(db, {
        id: randomUUID(),
        userId: user.id,
        workspaceId: workspace.id,
        ruleKind: 'auto-approve-action-kind',
        description: 'auto',
        matcher: { kind: 'auto-approve-action-kind', actionKind: 'file-write' },
        isEnabled: true,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      respondToApprovalRequestSpy.mockRejectedValueOnce(new Error('provider crashed'))

      await expect(
        recordApprovalRequest(db, {
          providerApprovalId: 'prov-crash',
          userId: user.id,
          workspaceId: workspace.id,
          sessionId: 'session-1',
          parentMessageId: 'message-1',
          toolUseId: 'tool-1',
          providerId: 'claude',
          toolName: 'Write',
          toolInput: { path: '/tmp/foo' },
        }),
      ).rejects.toThrow('provider crashed')

      // The initial pending row exists; the provider call failed AFTER
      // the row was committed. Recovery worker will time it out.
      const events = listOutboxEventsByType(db, 'approval.requested')
      expect(events).toHaveLength(1)
      // No auto-resolved event — the second tx never ran.
      expect(listOutboxEventsByType(db, 'approval.auto-resolved')).toHaveLength(0)
      // Look up the pending row by id from the event payload.
      const payload = events[0]!.payload as { approvalRequestId: string }
      const audit = findApprovalRequestById(db, payload.approvalRequestId)
      expect(audit?.status).toBe('pending')
    })
  })
})
