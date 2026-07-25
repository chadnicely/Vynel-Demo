// Tests for `listBackgroundRuns` / `getBackgroundRun` — the reads that make the
// jobId from send_task_to_workspace usable. Real SQLite. Pins the agent-facing
// status vocabulary, the preview/full-text split, tenant scoping, and the
// exclusion of report-delivery rows (the notify mechanism, not handed-off work).

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import type { Database } from '@vynel/db'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  insertDelegationJob,
  type DelegationJobKind,
  type DelegationJobStatus,
} from '../repositories/index.js'
import { getBackgroundRun, listBackgroundRuns } from './list-background-runs.js'

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
  input: {
    userId: string
    workspaceId: string | null
    workspaceName: string | null
    status: DelegationJobStatus
    taskText?: string
    resultText?: string | null
    errorMessage?: string | null
    jobKind?: DelegationJobKind
    createdAt?: Date
  },
): string {
  const id = randomUUID()
  const now = input.createdAt ?? new Date()
  const isTerminal = input.status === 'completed' || input.status === 'failed'
  insertDelegationJob(db, {
    id,
    userId: input.userId,
    parentSessionId: 'g-sess',
    workspaceId: input.workspaceId,
    workspacePath: '/tmp/vynel/acme',
    workspaceName: input.workspaceName,
    taskText: input.taskText ?? 'do the thing',
    partialSessionId: randomUUID(),
    status: input.status,
    claimedAt: input.status === 'claimed' ? now : null,
    completedAt: isTerminal ? now : null,
    resultText: input.resultText ?? null,
    errorMessage: input.errorMessage ?? null,
    surfacedToRootAt: null,
    createdAt: now,
    ...(input.jobKind !== undefined ? { jobKind: input.jobKind } : {}),
  })
  return id
}

describe('listBackgroundRuns', () => {
  // `claimed` is the queue's compare-and-swap word; it means nothing to a model
  // reading its own task list.
  it('maps queue statuses to the agent-facing vocabulary', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const base = { userId: user.id, workspaceId: workspace.id, workspaceName: 'Acme' }
      seedJob(db, { ...base, status: 'pending' })
      seedJob(db, { ...base, status: 'claimed' })
      seedJob(db, { ...base, status: 'completed', resultText: 'all done' })
      seedJob(db, { ...base, status: 'failed', errorMessage: 'it broke' })

      const runs = listBackgroundRuns(db, { userId: user.id })

      expect(runs.map((r) => r.status).sort()).toEqual([
        'completed',
        'failed',
        'queued',
        'running',
      ])
      expect(runs.every((r) => r.target === 'Acme')).toBe(true)
    })
  })

  it('spans every status in one list, newest first', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const base = { userId: user.id, workspaceId: workspace.id, workspaceName: 'Acme' }
      seedJob(db, { ...base, status: 'completed', taskText: 'older', createdAt: new Date(1_000) })
      seedJob(db, { ...base, status: 'pending', taskText: 'newer', createdAt: new Date(2_000) })

      const runs = listBackgroundRuns(db, { userId: user.id })

      expect(runs.map((r) => r.taskLabel)).toEqual(['newer', 'older'])
    })
  })

  // A list read must not be able to flood the agent's context; the full text is
  // one get_background_run away.
  it('truncates a long result in the list but serves it whole from the detail read', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const longResult = 'x'.repeat(1000)
      const jobId = seedJob(db, {
        userId: user.id,
        workspaceId: workspace.id,
        workspaceName: 'Acme',
        status: 'completed',
        resultText: longResult,
      })

      const [listed] = listBackgroundRuns(db, { userId: user.id })
      expect(listed!.resultPreview!.length).toBeLessThan(longResult.length)
      expect(listed!.resultPreview!.endsWith('…')).toBe(true)

      expect(getBackgroundRun(db, { userId: user.id, jobId })!.result).toBe(longResult)
    })
  })

  // A report-delivery row IS the notify mechanism — listing it would show the
  // agent its own report being delivered as though it were another task.
  it('excludes report-delivery rows from both reads', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const deliveryId = seedJob(db, {
        userId: user.id,
        workspaceId: workspace.id,
        workspaceName: 'Acme',
        status: 'completed',
        jobKind: 'report-delivery',
      })
      seedJob(db, {
        userId: user.id,
        workspaceId: workspace.id,
        workspaceName: 'Acme',
        status: 'completed',
        jobKind: 'task',
      })

      expect(listBackgroundRuns(db, { userId: user.id })).toHaveLength(1)
      expect(getBackgroundRun(db, { userId: user.id, jobId: deliveryId })).toBeNull()
    })
  })

  it('names a session-target run generically when there is no workspace', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      seedJob(db, {
        userId: user.id,
        workspaceId: null,
        workspaceName: null,
        status: 'pending',
      })

      expect(listBackgroundRuns(db, { userId: user.id })[0]!.target).toBe('Session')
    })
  })
})

describe('getBackgroundRun', () => {
  // Unknown and not-owned must be indistinguishable — the route maps both to one
  // 404, so a probe can't confirm a job id exists.
  it("returns null for another user's run, exactly as for an unknown id", async () => {
    await withTestDatabase((db) => {
      const owner = insertUser(db, makeUser())
      const stranger = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(owner.id))
      const jobId = seedJob(db, {
        userId: owner.id,
        workspaceId: workspace.id,
        workspaceName: 'Acme',
        status: 'completed',
        resultText: 'private findings',
      })

      expect(getBackgroundRun(db, { userId: stranger.id, jobId })).toBeNull()
      expect(getBackgroundRun(db, { userId: stranger.id, jobId: randomUUID() })).toBeNull()
      expect(getBackgroundRun(db, { userId: owner.id, jobId })).not.toBeNull()
    })
  })

  it('carries the failure reason and the task exactly as handed off', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const jobId = seedJob(db, {
        userId: user.id,
        workspaceId: workspace.id,
        workspaceName: 'Acme',
        status: 'failed',
        taskText: 'migrate the billing tables and report row counts',
        errorMessage: 'timed-out after 600000ms',
      })

      const run = getBackgroundRun(db, { userId: user.id, jobId })!

      expect(run.status).toBe('failed')
      expect(run.errorMessage).toBe('timed-out after 600000ms')
      expect(run.taskText).toBe('migrate the billing tables and report row counts')
      expect(run.result).toBeNull()
    })
  })
})
