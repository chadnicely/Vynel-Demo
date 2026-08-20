// The hand-over slot never dangles (audit r2 R2-H(d)). A follow-up job holds
// the identity's checkpoint slot until its own claim consumes it — so every
// OTHER way that job can settle (the boot pass, the lease sweeper, the user's
// Stop, a row that vanished) must hand the slot back and give it up visibly.
// A job still alive keeps its slot: the reconcile is terminal-or-gone only.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import type { Database } from '@vynel/db'
import { buildNewChatSessionRow } from '@vynel/chat'
import { insertChatSession, listRecentChatMessagesForSession } from '@vynel/chat/repositories'
import {
  claimNextPendingDelegationJob,
  completeDelegationJob,
  enqueueWorkspaceDelegation,
  failPendingDelegationJob,
} from '@vynel/orchestration'
import { insertPrimarySession } from '../repositories/index.js'
import {
  markContinuationJob,
  peekPendingCheckpoint,
  composeDroppedCheckpointNote,
  dropContinuationJobCheckpoint,
} from '../continuity/index.js'
import { reconcileContinuationJobs } from './reconcile-continuation-jobs.js'

type Scene = { primaryId: string; headId: string; jobId: string }

/** An identity whose checkpoint is HANDED OVER to a freshly enqueued follow-up. */
function seedHandedOverSlot(db: Database): Scene {
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
    name: 'Seo',
    kind: 'personal' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
  const headId = `sdk-${randomUUID()}`
  insertChatSession(
    db,
    buildNewChatSessionRow({
      sessionId: headId,
      userId: user.id,
      workspaceId: workspace.id,
      providerId: 'claude',
      startedAt: now,
      title: 'Seo',
      scope: 'workspace',
    }),
  )
  const primary = insertPrimarySession(db, {
    id: randomUUID(),
    userId: user.id,
    workspaceId: workspace.id,
    scope: 'workspace',
    currentSdkSessionId: headId,
    supersededFromSdkSessionId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  })
  const jobId = enqueueWorkspaceDelegation(db, {
    userId: user.id,
    parentSessionId: headId,
    workspaceId: workspace.id,
    workspacePath: workspace.path,
    workspaceName: workspace.name,
    taskText: 'Continuing after patching context — next: index the sitemap',
  })
  markContinuationJob(db, jobId, {
    primarySessionId: primary.id,
    nextStep: 'index the sitemap',
    continuationDepth: 1,
    checkpointedAt: now,
  })
  // Handed over = invisible to the identity itself until its job claims it.
  expect(peekPendingCheckpoint(db, primary.id)).toBeNull()
  return { primaryId: primary.id, headId, jobId }
}

function bodiesOn(db: Database, sessionId: string): string[] {
  return listRecentChatMessagesForSession(db, sessionId, 20).map((message) => message.body)
}

const LEFT_BEHIND_NOTE = composeDroppedCheckpointNote('index the sitemap', 'left-behind')

describe('reconcileContinuationJobs', () => {
  it('releases + drops the slot when the follow-up FAILED (the sweeper / boot settle path)', async () => {
    await withTestDatabase((db) => {
      const scene = seedHandedOverSlot(db)
      claimNextPendingDelegationJob(db, new Date())
      // What `failOrphanedClaimedDelegations` leaves behind: a terminal row
      // whose run never reached `beginDelegatedTurn`.
      completeDelegationJob(db, scene.jobId, '', new Date())

      expect(reconcileContinuationJobs(db)).toBe(1)
      expect(peekPendingCheckpoint(db, scene.primaryId)).toBeNull()
      expect(bodiesOn(db, scene.headId)).toEqual([LEFT_BEHIND_NOTE])
    })
  })

  it('releases + drops the slot when the follow-up was FAILED while pending (the Stop / cap settle path)', async () => {
    await withTestDatabase((db) => {
      const scene = seedHandedOverSlot(db)
      failPendingDelegationJob(db, scene.jobId, 'stopped by the user', new Date())

      expect(reconcileContinuationJobs(db)).toBe(1)
      expect(peekPendingCheckpoint(db, scene.primaryId)).toBeNull()
      expect(bodiesOn(db, scene.headId)).toEqual([LEFT_BEHIND_NOTE])
    })
  })

  it('releases + drops the slot when the follow-up ROW IS GONE (a purged / never-written job)', async () => {
    await withTestDatabase((db) => {
      const scene = seedHandedOverSlot(db)
      // Re-hand the slot to an id no queue row carries — the shape a deleted
      // job leaves behind.
      markContinuationJob(db, randomUUID(), {
        primarySessionId: scene.primaryId,
        nextStep: 'index the sitemap',
        continuationDepth: 1,
        checkpointedAt: new Date(),
      })

      expect(reconcileContinuationJobs(db)).toBe(1)
      expect(peekPendingCheckpoint(db, scene.primaryId)).toBeNull()
      expect(bodiesOn(db, scene.headId)).toEqual([LEFT_BEHIND_NOTE])
    })
  })

  it('leaves a PENDING follow-up alone — it is still going to claim its checkpoint', async () => {
    await withTestDatabase((db) => {
      const scene = seedHandedOverSlot(db)

      expect(reconcileContinuationJobs(db)).toBe(0)
      expect(peekPendingCheckpoint(db, scene.primaryId)).toBeNull()
      expect(bodiesOn(db, scene.headId)).toEqual([])
    })
  })

  it('leaves a CLAIMED follow-up alone — a claim in flight is not a settle', async () => {
    await withTestDatabase((db) => {
      const scene = seedHandedOverSlot(db)
      claimNextPendingDelegationJob(db, new Date())

      expect(reconcileContinuationJobs(db)).toBe(0)
      expect(bodiesOn(db, scene.headId)).toEqual([])
    })
  })
})

describe('dropContinuationJobCheckpoint — the Stop route’s immediate release', () => {
  it('gives the slot up at once, with the stop’s own reason', async () => {
    await withTestDatabase((db) => {
      const scene = seedHandedOverSlot(db)

      const dropped = dropContinuationJobCheckpoint(db, scene.jobId, { reason: 'turn-stopped' })

      expect(dropped?.nextStep).toBe('index the sitemap')
      expect(peekPendingCheckpoint(db, scene.primaryId)).toBeNull()
      expect(bodiesOn(db, scene.headId)).toEqual([
        composeDroppedCheckpointNote('index the sitemap', 'turn-stopped'),
      ])
    })
  })

  it('answers null for a job no identity handed anything to', async () => {
    await withTestDatabase((db) => {
      seedHandedOverSlot(db)
      expect(dropContinuationJobCheckpoint(db, randomUUID(), { reason: 'turn-stopped' })).toBeNull()
    })
  })
})
