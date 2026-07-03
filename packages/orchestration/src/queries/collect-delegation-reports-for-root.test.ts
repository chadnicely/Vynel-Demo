// Test for `collectDelegationReportsForRoot` (brain-tree Ch3.5, the root-awareness fix) —
// real SQLite. The terminal delegations the root hasn't seen become a context block; once
// marked surfaced they're NOT re-collected (exactly-once — the discriminating test).

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import type { Database } from '@vynel/db'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  insertDelegationJob,
  markDelegationsSurfacedToRoot,
  type DelegationJobStatus,
} from '../repositories/index.js'
import { collectDelegationReportsForRoot } from './collect-delegation-reports-for-root.js'

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

function makeWorkspace(userId: string, name = 'Acme') {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    name,
    kind: 'personal' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }
}

function seedJob(
  db: Database,
  userId: string,
  workspaceId: string,
  workspaceName: string,
  status: DelegationJobStatus,
  fields: { resultText?: string | null; errorMessage?: string | null } = {},
): string {
  const id = randomUUID()
  const now = new Date()
  insertDelegationJob(db, {
    id,
    userId,
    parentSessionId: 'g-sess',
    workspaceId,
    workspacePath: '/tmp/vynel/acme',
    workspaceName,
    taskText: 'do the thing',
    partialSessionId: randomUUID(),
    status,
    claimedAt: now,
    completedAt: status === 'completed' || status === 'failed' ? now : null,
    resultText: fields.resultText ?? null,
    errorMessage: fields.errorMessage ?? null,
    surfacedToRootAt: null,
    createdAt: now,
  })
  return id
}

describe('collectDelegationReportsForRoot', () => {
  it('collects a completed delegation as a context block with its result', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      seedJob(db, user.id, workspace.id, 'Acme', 'completed', { resultText: 'Three docs, all current.' })

      const reports = collectDelegationReportsForRoot(db, { userId: user.id })
      expect(reports.jobIds).toHaveLength(1)
      expect(reports.contextBlock).toContain('Acme: Three docs, all current.')
      expect(reports.contextBlock).toContain('system-supplied')
    })
  })

  it('surfaces a FAILED delegation so the root never says "still working"', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      seedJob(db, user.id, workspace.id, 'Acme', 'failed', { errorMessage: 'timed-out after 600000ms' })

      const reports = collectDelegationReportsForRoot(db, { userId: user.id })
      expect(reports.jobIds).toHaveLength(1)
      expect(reports.contextBlock).toContain("couldn't complete")
      expect(reports.contextBlock).toContain('timed-out')
    })
  })

  it('ignores in-flight (pending/claimed) delegations — only terminal ones surface', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      seedJob(db, user.id, workspace.id, 'Acme', 'pending')
      seedJob(db, user.id, workspace.id, 'Acme', 'claimed')

      const reports = collectDelegationReportsForRoot(db, { userId: user.id })
      expect(reports.contextBlock).toBeNull()
      expect(reports.jobIds).toEqual([])
    })
  })

  it('surfaces EXACTLY ONCE — a marked report is not re-collected on the next turn', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      seedJob(db, user.id, workspace.id, 'Acme', 'completed', { resultText: 'done' })

      const first = collectDelegationReportsForRoot(db, { userId: user.id })
      expect(first.jobIds).toHaveLength(1)

      // The turn marks them surfaced — the next turn must NOT re-inject (no context re-bloat).
      markDelegationsSurfacedToRoot(db, first.jobIds, new Date())
      const second = collectDelegationReportsForRoot(db, { userId: user.id })
      expect(second.contextBlock).toBeNull()
      expect(second.jobIds).toEqual([])
    })
  })

  it('scopes to the owning user — another user’s reports never surface', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const other = insertUser(db, makeUser())
      const otherWorkspace = insertWorkspace(db, makeWorkspace(other.id))
      seedJob(db, other.id, otherWorkspace.id, 'Theirs', 'completed', { resultText: 'secret' })

      const reports = collectDelegationReportsForRoot(db, { userId: user.id })
      expect(reports.contextBlock).toBeNull()
    })
  })
})
