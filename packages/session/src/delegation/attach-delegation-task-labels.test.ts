// The Watch-chip enrichment: report rows carrying a partialSessionId gain the
// delegated task's short label; ordinary rows and orphaned keys pass through
// untouched. Real db, real jobs — never mock the DB.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { enqueueWorkspaceDelegation, findDelegationJobById } from '@vynel/orchestration'
import type { Database } from '@vynel/db'
import { attachDelegationTaskLabels } from './attach-delegation-task-labels.js'

function seedJob(db: Database, taskText: string): string {
  const now = new Date()
  const user = insertUser(db, {
    id: randomUUID(),
    displayName: 'T',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  })
  const workspace = insertWorkspace(db, {
    id: randomUUID(),
    userId: user.id,
    name: 'Acme',
    path: 'C:/tmp/acme',
    kind: 'project',
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
  const jobId = enqueueWorkspaceDelegation(db, {
    userId: user.id,
    parentSessionId: 'root-1',
    workspaceId: workspace.id,
    workspacePath: workspace.path,
    workspaceName: workspace.name,
    taskText,
  })
  return findDelegationJobById(db, jobId)!.partialSessionId!
}

describe('attachDelegationTaskLabels', () => {
  it('labels report rows from their job and passes ordinary rows through', async () => {
    await withTestDatabase((db) => {
      const key = seedJob(db, 'Set up the login page\nwith full details below.')
      const enriched = attachDelegationTaskLabels(db, [
        { id: 'm1', partialSessionId: null },
        { id: 'm2', partialSessionId: key },
        { id: 'm3', partialSessionId: key }, // same job twice — one lookup, same label
      ])

      expect(enriched[0]).toEqual({ id: 'm1', partialSessionId: null })
      expect(enriched[1]).toEqual({
        id: 'm2',
        partialSessionId: key,
        delegationTaskLabel: 'Set up the login page',
      })
      expect(enriched[2]!.delegationTaskLabel).toBe('Set up the login page')
    })
  })

  it('leaves a row untouched when its job is gone', async () => {
    await withTestDatabase((db) => {
      const enriched = attachDelegationTaskLabels(db, [
        { id: 'm1', partialSessionId: 'no-such-key' },
      ])
      expect(enriched[0]).toEqual({ id: 'm1', partialSessionId: 'no-such-key' })
    })
  })
})
