import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  insertApprovalRequest,
  listApprovalRequestsForWorkspace,
  type NewApprovalRequest,
} from '../repositories/index.js'
import { purgeOldApprovalRequests } from './purge-old-approval-requests.js'

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
function makeRow(userId: string, workspaceId: string, requestedAt: Date): NewApprovalRequest {
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
    status: 'resolved',
    resolutionKind: 'approved',
    resolutionReason: null,
    resolutionUpdatedInput: null,
    autoApprovedByRuleId: null,
    timeoutMs: 300_000,
    requestedAt,
    resolvedAt: requestedAt,
  }
}

describe('purgeOldApprovalRequests', () => {
  it('hard-deletes rows older than 90 days (retention window)', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))

      const now = new Date('2026-05-24T00:00:00Z')
      // 100 days ago — should purge.
      insertApprovalRequest(db, makeRow(user.id, workspace.id, new Date('2026-02-13T00:00:00Z')))
      // 80 days ago — should NOT purge.
      insertApprovalRequest(db, makeRow(user.id, workspace.id, new Date('2026-03-05T00:00:00Z')))
      // Today — should NOT purge.
      insertApprovalRequest(db, makeRow(user.id, workspace.id, now))

      const result = purgeOldApprovalRequests(db, { now: () => now })

      expect(result.purgedCount).toBe(1)
      const survivors = listApprovalRequestsForWorkspace(db, workspace.id, { limit: 100 })
      expect(survivors).toHaveLength(2)
    })
  })

  it('no-ops on empty DB', async () => {
    await withTestDatabase((db) => {
      const now = new Date('2026-05-24T00:00:00Z')
      const result = purgeOldApprovalRequests(db, { now: () => now })
      expect(result.purgedCount).toBe(0)
    })
  })
})
