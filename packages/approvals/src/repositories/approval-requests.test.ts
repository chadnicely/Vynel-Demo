// Repository tests for `approval_requests`. Real SQLite via the local
// withTestDatabase helper.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  findApprovalRequestById,
  findApprovalRequestByProviderApprovalId,
  listPendingApprovalRequestsForSession,
  listPendingApprovalsForUser,
  listApprovalRequestsForWorkspace,
  listStalePendingApprovalRequests,
  insertApprovalRequest,
  updateApprovalRequest,
  hardDeleteApprovalRequestsRequestedBefore,
  type NewApprovalRequest,
} from './approval-requests.js'

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

function makeApprovalRequest(
  userId: string,
  workspaceId: string | null,
  overrides: Partial<NewApprovalRequest> = {},
): NewApprovalRequest {
  const now = new Date()
  return {
    id: randomUUID(),
    providerApprovalId: `provider-${randomUUID()}`,
    userId,
    workspaceId,
    sessionId: `session-${randomUUID()}`,
    parentMessageId: `message-${randomUUID()}`,
    toolUseId: `tool-${randomUUID()}`,
    toolName: 'Write',
    actionKind: 'file-write',
    toolInput: { path: '/tmp/foo' },
    status: 'pending',
    resolutionKind: null,
    resolutionReason: null,
    resolutionUpdatedInput: null,
    autoApprovedByRuleId: null,
    timeoutMs: 300_000,
    requestedAt: now,
    resolvedAt: null,
    ...overrides,
  }
}

describe('approval-requests repository', () => {
  describe('findApprovalRequestById', () => {
    it('returns null when no row matches', async () => {
      await withTestDatabase((db) => {
        expect(findApprovalRequestById(db, 'nonexistent')).toBeNull()
      })
    })

    it('returns the row when found', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const inserted = insertApprovalRequest(db, makeApprovalRequest(user.id, workspace.id))
        const found = findApprovalRequestById(db, inserted.id)
        expect(found?.id).toBe(inserted.id)
        expect(found?.toolName).toBe('Write')
      })
    })
  })

  describe('findApprovalRequestByProviderApprovalId', () => {
    it('returns null when no row matches', async () => {
      await withTestDatabase((db) => {
        expect(findApprovalRequestByProviderApprovalId(db, 'nope')).toBeNull()
      })
    })

    it('returns the row when found (hot route lookup)', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const inserted = insertApprovalRequest(
          db,
          makeApprovalRequest(user.id, workspace.id, { providerApprovalId: 'prov-abc-123' }),
        )
        const found = findApprovalRequestByProviderApprovalId(db, 'prov-abc-123')
        expect(found?.id).toBe(inserted.id)
      })
    })
  })

  describe('listPendingApprovalRequestsForSession', () => {
    it('returns only pending rows for the session, newest first', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const sessionId = `session-${randomUUID()}`
        const earlier = new Date('2026-05-23T10:00:00Z')
        const later = new Date('2026-05-23T11:00:00Z')
        insertApprovalRequest(
          db,
          makeApprovalRequest(user.id, workspace.id, { sessionId, requestedAt: earlier }),
        )
        const newer = insertApprovalRequest(
          db,
          makeApprovalRequest(user.id, workspace.id, { sessionId, requestedAt: later }),
        )
        // Resolved row — should not appear.
        insertApprovalRequest(
          db,
          makeApprovalRequest(user.id, workspace.id, {
            sessionId,
            status: 'resolved',
            resolutionKind: 'approved',
            resolvedAt: new Date(),
          }),
        )
        // Different session — should not appear.
        insertApprovalRequest(db, makeApprovalRequest(user.id, workspace.id))

        const rows = listPendingApprovalRequestsForSession(db, sessionId)
        expect(rows).toHaveLength(2)
        expect(rows[0]!.id).toBe(newer.id)
      })
    })
  })

  describe('listPendingApprovalsForUser', () => {
    it('returns pending across ALL workspaces + sessions for the user, newest first', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const other = insertUser(db, makeUser())
        const ws1 = insertWorkspace(db, makeWorkspace(user.id))
        const ws2 = insertWorkspace(db, makeWorkspace(user.id))
        const t1 = new Date('2026-05-23T10:00:00Z')
        const t2 = new Date('2026-05-23T11:00:00Z')
        insertApprovalRequest(db, makeApprovalRequest(user.id, ws1.id, { requestedAt: t1 }))
        const newer = insertApprovalRequest(
          db,
          makeApprovalRequest(user.id, ws2.id, { requestedAt: t2 }),
        )
        // Resolved row — excluded.
        insertApprovalRequest(
          db,
          makeApprovalRequest(user.id, ws1.id, {
            status: 'resolved',
            resolutionKind: 'approved',
            resolvedAt: new Date(),
          }),
        )
        // Another user's pending — excluded (tenant isolation).
        const otherWs = insertWorkspace(db, makeWorkspace(other.id))
        insertApprovalRequest(db, makeApprovalRequest(other.id, otherWs.id))

        const rows = listPendingApprovalsForUser(db, user.id)
        expect(rows).toHaveLength(2)
        expect(rows[0]!.id).toBe(newer.id)
      })
    })

    it('includes workspace-less global-root (brain) cards', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const brain = insertApprovalRequest(
          db,
          makeApprovalRequest(user.id, null, { sessionId: 'brain-1' }),
        )
        const rows = listPendingApprovalsForUser(db, user.id)
        expect(rows.map((r) => r.id)).toContain(brain.id)
        expect(rows.find((r) => r.id === brain.id)?.workspaceId).toBeNull()
      })
    })
  })

  describe('listApprovalRequestsForWorkspace', () => {
    it('caps at the defensive limit (200)', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        // Default cap is 50; passing limit=1000 should cap at 200.
        const rows = listApprovalRequestsForWorkspace(db, workspace.id, { limit: 1000 })
        expect(rows.length).toBeLessThanOrEqual(200)
      })
    })

    it('orders by requestedAt desc then id desc', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const t1 = new Date('2026-05-23T10:00:00Z')
        const t2 = new Date('2026-05-23T11:00:00Z')
        insertApprovalRequest(db, makeApprovalRequest(user.id, workspace.id, { requestedAt: t1 }))
        const newer = insertApprovalRequest(
          db,
          makeApprovalRequest(user.id, workspace.id, { requestedAt: t2 }),
        )
        const rows = listApprovalRequestsForWorkspace(db, workspace.id)
        expect(rows[0]!.id).toBe(newer.id)
      })
    })

    it('cursor-paginates by (requestedAt, id) keyset', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const t1 = new Date('2026-05-23T10:00:00Z')
        const t2 = new Date('2026-05-23T11:00:00Z')
        const t3 = new Date('2026-05-23T12:00:00Z')
        insertApprovalRequest(db, makeApprovalRequest(user.id, workspace.id, { requestedAt: t1 }))
        const middle = insertApprovalRequest(
          db,
          makeApprovalRequest(user.id, workspace.id, { requestedAt: t2 }),
        )
        const newest = insertApprovalRequest(
          db,
          makeApprovalRequest(user.id, workspace.id, { requestedAt: t3 }),
        )
        // Get page 1 (limit 1) — newest.
        const page1 = listApprovalRequestsForWorkspace(db, workspace.id, { limit: 1 })
        expect(page1[0]!.id).toBe(newest.id)
        // Get page 2 using the cursor from page 1's last row.
        const page2 = listApprovalRequestsForWorkspace(db, workspace.id, {
          limit: 1,
          cursor: { requestedAt: page1[0]!.requestedAt, id: page1[0]!.id },
        })
        expect(page2[0]!.id).toBe(middle.id)
      })
    })
  })

  describe('listStalePendingApprovalRequests', () => {
    it('filters by status=pending AND requestedAt < staleBefore', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const old = new Date('2026-05-23T10:00:00Z')
        const recent = new Date('2026-05-23T13:00:00Z')
        const cutoff = new Date('2026-05-23T12:00:00Z')

        const stalePending = insertApprovalRequest(
          db,
          makeApprovalRequest(user.id, workspace.id, { requestedAt: old }),
        )
        // Old but resolved — should not appear.
        insertApprovalRequest(
          db,
          makeApprovalRequest(user.id, workspace.id, {
            requestedAt: old,
            status: 'resolved',
            resolutionKind: 'approved',
            resolvedAt: old,
          }),
        )
        // Recent pending — should not appear (not yet stale).
        insertApprovalRequest(
          db,
          makeApprovalRequest(user.id, workspace.id, { requestedAt: recent }),
        )

        const rows = listStalePendingApprovalRequests(db, { staleBefore: cutoff })
        expect(rows).toHaveLength(1)
        expect(rows[0]!.id).toBe(stalePending.id)
      })
    })
  })

  describe('insertApprovalRequest', () => {
    it('returns the inserted row', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const newRequest = makeApprovalRequest(user.id, workspace.id)
        const inserted = insertApprovalRequest(db, newRequest)
        expect(inserted.id).toBe(newRequest.id)
        expect(inserted.toolInput).toEqual({ path: '/tmp/foo' })
      })
    })
  })

  describe('updateApprovalRequest', () => {
    it('returns the updated row', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const inserted = insertApprovalRequest(db, makeApprovalRequest(user.id, workspace.id))
        const resolvedAt = new Date()
        const updated = updateApprovalRequest(db, inserted.id, {
          status: 'resolved',
          resolutionKind: 'approved',
          resolvedAt,
        })
        expect(updated.status).toBe('resolved')
        expect(updated.resolutionKind).toBe('approved')
      })
    })

    it('throws plain Error on missing id', async () => {
      await withTestDatabase((db) => {
        expect(() => updateApprovalRequest(db, 'nonexistent', { status: 'resolved' })).toThrow(
          /updateApprovalRequest: no row/,
        )
      })
    })
  })

  describe('hardDeleteApprovalRequestsRequestedBefore', () => {
    it('returns the deleted count (retention purge)', async () => {
      await withTestDatabase((db) => {
        const user = insertUser(db, makeUser())
        const workspace = insertWorkspace(db, makeWorkspace(user.id))
        const old = new Date('2026-01-01T00:00:00Z')
        const recent = new Date('2026-05-23T00:00:00Z')
        const cutoff = new Date('2026-03-01T00:00:00Z')

        insertApprovalRequest(db, makeApprovalRequest(user.id, workspace.id, { requestedAt: old }))
        insertApprovalRequest(db, makeApprovalRequest(user.id, workspace.id, { requestedAt: old }))
        insertApprovalRequest(
          db,
          makeApprovalRequest(user.id, workspace.id, { requestedAt: recent }),
        )

        const purged = hardDeleteApprovalRequestsRequestedBefore(db, cutoff)
        expect(purged).toBe(2)
        // Survivor: the recent row.
        const survivors = listApprovalRequestsForWorkspace(db, workspace.id)
        expect(survivors).toHaveLength(1)
      })
    })
  })
})
