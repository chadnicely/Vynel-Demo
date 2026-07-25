// Tests for the chain key. Real SQLite. The point of `threadId` is the thing
// `partialSessionId` structurally cannot do — link the hops of one task — so
// these pin the multi-hop walk, the self-seed, and the legacy-row read that
// lets the migration skip a backfill.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import type { Database } from '@vynel/db'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { enqueueWorkspaceDelegation } from '../routing/enqueue-workspace-delegation.js'
import { enqueueReportDelivery } from '../routing/enqueue-report-delivery.js'
import { findDelegationJobById, insertDelegationJob } from '../repositories/index.js'
import { resolveThreadId } from '../routing/resolve-thread-id.js'
import { resolveThreadChain } from './resolve-thread-chain.js'

function seedUser(db: Database) {
  const now = new Date()
  return insertUser(db, {
    id: randomUUID(),
    displayName: 'Dana',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  })
}

function seedWorkspace(db: Database, userId: string) {
  const now = new Date()
  return insertWorkspace(db, {
    id: randomUUID(),
    userId,
    name: 'Acme',
    kind: 'personal' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
}

describe('resolveThreadId', () => {
  // A chain-starting hop seeds the thread from its OWN key. That is what makes a
  // legacy row (threadId NULL) read identically to a modern starting row.
  it('starts a chain by self-seeding, and inherits when continuing', () => {
    expect(resolveThreadId({ partialSessionId: 'hop-1' })).toBe('hop-1')
    expect(
      resolveThreadId({ inheritedThreadId: 'thread-A', partialSessionId: 'hop-2' }),
    ).toBe('thread-A')
    // A blank inherited value is not a thread — treat it as starting one.
    expect(
      resolveThreadId({ inheritedThreadId: '   ', partialSessionId: 'hop-3' }),
    ).toBe('hop-3')
  })
})

describe('resolveThreadChain', () => {
  it('links a task and the report it caused into one chain', async () => {
    await withTestDatabase((db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)

      // Staggered clocks: the chain lists hops by (createdAt, id), so two rows
      // written in the same millisecond would tie-break on a RANDOM uuid and the
      // order assertion below would flip about half the time.
      const enqueuedAt = (offsetMs: number) => ({ now: () => new Date(1_700_000_000_000 + offsetMs) })

      // Hop 1 — global sends a task down. Starts the chain.
      const taskJobId = enqueueWorkspaceDelegation(db, {
        userId: user.id,
        parentSessionId: 'global-sess',
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'summarize the docs',
      }, enqueuedAt(0))
      const taskJob = findDelegationJobById(db, taskJobId)!
      // The self-seed: a starting hop's thread IS its own hop key.
      expect(taskJob.threadId).toBe(taskJob.partialSessionId)

      // Hop 2 — the workspace reports back up, CONTINUING the chain.
      enqueueReportDelivery(db, {
        userId: user.id,
        reporterSessionId: 'ws-sess',
        reporterLabel: 'Mark · Acme',
        reportBody: 'done, 12 docs',
        requester: { kind: 'global-root' },
        threadId: taskJob.threadId!,
      }, enqueuedAt(1))

      // Anchored from EITHER hop's key, the chain is the same two hops.
      const chain = resolveThreadChain(db, {
        userId: user.id,
        partialSessionId: taskJob.partialSessionId!,
      })!
      expect(chain.hops).toHaveLength(2)
      expect(chain.hops.map((h) => h.kind)).toEqual(['task', 'report-delivery'])
      expect(chain.threadId).toBe(taskJob.threadId)
    })
  })

  // Before threadId existed every hop WAS its own chain, so a NULL row must read
  // as exactly that — this is what lets migration 0020 skip a backfill.
  it('reads a legacy row (threadId NULL) as its own single-hop chain', async () => {
    await withTestDatabase((db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)
      // A pre-migration row: inserted straight through the repo with threadId
      // left unset, which is exactly the shape migration 0020 leaves behind.
      const legacyKey = randomUUID()
      insertDelegationJob(db, {
        id: randomUUID(),
        userId: user.id,
        parentSessionId: 'global-sess',
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'legacy work',
        partialSessionId: legacyKey,
        status: 'completed',
        claimedAt: null,
        completedAt: new Date(),
        resultText: 'done',
        errorMessage: null,
        surfacedToRootAt: null,
        createdAt: new Date(),
      })

      const chain = resolveThreadChain(db, { userId: user.id, partialSessionId: legacyKey })!
      expect(chain.hops).toHaveLength(1)
      expect(chain.threadId).toBe(legacyKey)
    })
  })

  // Same no-enumeration-leak contract resolveDelegationTrace keeps.
  it('returns null for an unknown key and for another user’s chain', async () => {
    await withTestDatabase((db) => {
      const owner = seedUser(db)
      const stranger = seedUser(db)
      const workspace = seedWorkspace(db, owner.id)
      const jobId = enqueueWorkspaceDelegation(db, {
        userId: owner.id,
        parentSessionId: 'global-sess',
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        taskText: 'private',
      })
      const job = findDelegationJobById(db, jobId)!

      expect(
        resolveThreadChain(db, { userId: stranger.id, partialSessionId: job.partialSessionId! }),
      ).toBeNull()
      expect(
        resolveThreadChain(db, { userId: owner.id, partialSessionId: randomUUID() }),
      ).toBeNull()
    })
  })
})
