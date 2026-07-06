// Test for `listInFlightDelegations` (brain-tree Ch3.5) — the /global processing indicator
// read. Real SQLite. In-flight = pending + claimed; terminal jobs are excluded; user-scoped.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import type { Database } from '@vynel/db'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { insertDelegationJob, type DelegationJobStatus } from '../repositories/index.js'
import { listInFlightDelegations } from './list-in-flight-delegations.js'

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
    claimedAt: status === 'claimed' ? now : null,
    completedAt: status === 'completed' || status === 'failed' ? now : null,
    resultText: null,
    errorMessage: null,
    surfacedToRootAt: null,
    createdAt: now,
  })
  return id
}

describe('listInFlightDelegations', () => {
  it('returns pending + claimed delegations shaped for the indicator', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      seedJob(db, user.id, workspace.id, 'Acme', 'pending')
      seedJob(db, user.id, workspace.id, 'Acme', 'claimed')

      const inFlight = listInFlightDelegations(db, { userId: user.id })
      expect(inFlight).toHaveLength(2)
      expect(inFlight.map((d) => d.status).sort()).toEqual(['claimed', 'pending'])
      expect(inFlight[0]).toMatchObject({ workspaceName: 'Acme' })
      expect(typeof inFlight[0]!.workspaceId).toBe('string')
      expect(typeof inFlight[0]!.partialSessionId).toBe('string')
    })
  })

  it('excludes terminal (completed / failed) delegations', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      seedJob(db, user.id, workspace.id, 'Acme', 'completed')
      seedJob(db, user.id, workspace.id, 'Acme', 'failed')
      seedJob(db, user.id, workspace.id, 'Acme', 'pending')

      const inFlight = listInFlightDelegations(db, { userId: user.id })
      expect(inFlight).toHaveLength(1)
      expect(inFlight[0]!.status).toBe('pending')
    })
  })

  it('scopes to the owning user', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const other = insertUser(db, makeUser())
      const otherWorkspace = insertWorkspace(db, makeWorkspace(other.id))
      seedJob(db, other.id, otherWorkspace.id, 'Theirs', 'claimed')

      expect(listInFlightDelegations(db, { userId: user.id })).toEqual([])
    })
  })
})
