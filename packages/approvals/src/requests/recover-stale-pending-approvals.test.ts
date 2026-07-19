import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  insertApprovalRequest,
  findApprovalRequestById,
  type NewApprovalRequest,
} from '../repositories/index.js'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { NotFoundError } from '@vynel/errors'
import { recoverStalePendingApprovals } from './recover-stale-pending-approvals.js'

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
function makeRow(
  userId: string,
  workspaceId: string,
  requestedAt: Date,
  timeoutMs = 300_000,
  status: 'pending' | 'resolved' = 'pending',
): NewApprovalRequest {
  return {
    id: randomUUID(),
    providerApprovalId: `provider-${randomUUID()}`,
    userId,
    workspaceId,
    sessionId: 'session-1',
    parentMessageId: 'message-1',
    toolUseId: 'tool-1',
    toolName: 'Write',
    actionKind: 'file-write',
    toolInput: { path: '/tmp/foo' },
    status,
    resolutionKind: status === 'resolved' ? 'approved' : null,
    resolutionReason: null,
    resolutionUpdatedInput: null,
    autoApprovedByRuleId: null,
    timeoutMs,
    requestedAt,
    resolvedAt: status === 'resolved' ? requestedAt : null,
  }
}

describe('recoverStalePendingApprovals', () => {
  it('resolves only rows aged past requestedAt + timeoutMs * 2', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))

      const now = new Date('2026-05-24T12:00:00Z')
      // Stale (15 min old, default 5-min timeout × 2 = 10 min) — should be reaped.
      const stale = insertApprovalRequest(
        db,
        makeRow(user.id, workspace.id, new Date('2026-05-24T11:45:00Z')),
      )
      // Fresh (2 min old) — should NOT be reaped.
      const fresh = insertApprovalRequest(
        db,
        makeRow(user.id, workspace.id, new Date('2026-05-24T11:58:00Z')),
      )

      const result = await recoverStalePendingApprovals(db, { now: () => now })

      expect(result.resolvedCount).toBe(1)
      expect(findApprovalRequestById(db, stale.id)?.status).toBe('resolved')
      expect(findApprovalRequestById(db, stale.id)?.resolutionKind).toBe('timed-out')
      expect(findApprovalRequestById(db, fresh.id)?.status).toBe('pending')

      const events = listOutboxEventsByType(db, 'approval.timed-out')
      expect(events).toHaveLength(1)
    })
  })

  it('reapAllPending (boot recovery): reaps EVERY pending row regardless of age', async () => {
    // At boot the waiter registry is empty by definition — a fresh pending row
    // is just as orphaned as a stale one; leaving it would show a ghost card
    // (undecidable park) for up to timeoutMs × 2 after every dev restart.
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))

      const now = new Date('2026-05-24T12:00:00Z')
      const fresh = insertApprovalRequest(
        db,
        makeRow(user.id, workspace.id, new Date('2026-05-24T11:59:30Z')), // 30s old
      )

      const result = await recoverStalePendingApprovals(db, {
        now: () => now,
        reapAllPending: true,
      })

      expect(result.resolvedCount).toBe(1)
      expect(findApprovalRequestById(db, fresh.id)?.status).toBe('resolved')
      expect(findApprovalRequestById(db, fresh.id)?.resolutionKind).toBe('timed-out')
    })
  })

  it('respects per-row timeoutMs (channels may use longer windows)', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))

      const now = new Date('2026-05-24T12:00:00Z')
      // 30 min old; default 5-min timeout × 2 = 10 min → would be stale.
      // But this row has a 20-min timeout × 2 = 40 min → NOT stale yet.
      const row = insertApprovalRequest(
        db,
        makeRow(user.id, workspace.id, new Date('2026-05-24T11:30:00Z'), 20 * 60 * 1000),
      )

      const result = await recoverStalePendingApprovals(db, { now: () => now })

      expect(result.resolvedCount).toBe(0)
      expect(findApprovalRequestById(db, row.id)?.status).toBe('pending')
    })
  })

  it('does not re-process already-resolved rows (status filter at the repo)', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))

      const now = new Date('2026-05-24T12:00:00Z')
      const resolved = insertApprovalRequest(
        db,
        makeRow(user.id, workspace.id, new Date('2026-05-24T01:00:00Z'), 300_000, 'resolved'),
      )

      const result = await recoverStalePendingApprovals(db, { now: () => now })

      expect(result.resolvedCount).toBe(0)
      // Original resolution preserved.
      expect(findApprovalRequestById(db, resolved.id)?.resolutionKind).toBe('approved')
    })
  })

  it('unblocks a same-process parked provider approval BEFORE the row update (surface-up)', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))

      const now = new Date('2026-05-24T12:00:00Z')
      const stale = insertApprovalRequest(
        db,
        makeRow(user.id, workspace.id, new Date('2026-05-24T11:45:00Z')),
      )

      const unblocked: string[] = []
      const result = await recoverStalePendingApprovals(db, {
        now: () => now,
        unblockProvider: async (providerApprovalId) => {
          unblocked.push(providerApprovalId)
        },
      })

      expect(result.resolvedCount).toBe(1)
      expect(unblocked).toEqual([stale.providerApprovalId])
      expect(findApprovalRequestById(db, stale.id)?.resolutionKind).toBe('timed-out')
    })
  })

  it('still reaps the row when the registry no longer knows the id (post-restart) — the unblock throw is swallowed + logged', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))

      const now = new Date('2026-05-24T12:00:00Z')
      const stale = insertApprovalRequest(
        db,
        makeRow(user.id, workspace.id, new Date('2026-05-24T11:45:00Z')),
      )

      const result = await recoverStalePendingApprovals(db, {
        now: () => now,
        unblockProvider: async () => {
          throw new NotFoundError('approval_request', 'gone-with-the-process')
        },
      })

      expect(result.resolvedCount).toBe(1)
      expect(findApprovalRequestById(db, stale.id)?.status).toBe('resolved')
    })
  })

  it('keeps the row PENDING when the unblock fails for any non-NotFound reason (never strip reaper coverage)', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))

      const now = new Date('2026-05-24T12:00:00Z')
      const stale = insertApprovalRequest(
        db,
        makeRow(user.id, workspace.id, new Date('2026-05-24T11:45:00Z')),
      )

      const result = await recoverStalePendingApprovals(db, {
        now: () => now,
        unblockProvider: async () => {
          throw new Error('provider transport hiccup')
        },
      })

      // The row stays pending — the next tick retries the unblock; marking it
      // timed-out here would leave a possibly-still-parked agent uncovered.
      expect(result.resolvedCount).toBe(0)
      expect(findApprovalRequestById(db, stale.id)?.status).toBe('pending')
    })
  })
})
