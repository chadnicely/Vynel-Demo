// The orphan-settlement policy's THIRD pass (audit r2 R2-H(d)): both readers —
// the boot sweep and the 60 s lease sweep — also reconcile the checkpoint
// hand-over slots. A follow-up job that settled without ever claiming its
// checkpoint would otherwise hold the identity's slot forever: invisible to
// peek/take, never continued, never dropped, and blocking a new checkpoint.
// Real SQLite; the delegation repos are the real ones.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import type { Database } from '@vynel/db'
import { buildNewChatSessionRow } from '@vynel/chat'
import { insertChatSession, listRecentChatMessagesForSession } from '@vynel/chat/repositories'
import { enqueueWorkspaceDelegation, failPendingDelegationJob } from '@vynel/orchestration'
import {
  composeDroppedCheckpointNote,
  getOrCreatePrimarySession,
  linkPrimarySessionToSdkSession,
  markContinuationJob,
  peekPendingCheckpoint,
} from '@vynel/session/continuity'
import { settleOrphanedDelegationClaims } from './delegation-orphan-settlement.js'

const logger = pino({ level: 'silent' })

async function seedStrandedHandOver(db: Database): Promise<{ primaryId: string; headId: string }> {
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
  const primary = await getOrCreatePrimarySession(db, {
    userId: user.id,
    workspaceId: workspace.id,
  })
  linkPrimarySessionToSdkSession(db, {
    primarySessionId: primary.id,
    userId: user.id,
    sdkSessionId: headId,
  })
  const jobId = enqueueWorkspaceDelegation(db, {
    userId: user.id,
    parentSessionId: headId,
    workspaceId: workspace.id,
    workspacePath: workspace.path,
    workspaceName: workspace.name,
    taskText: 'Continuing after patching context — next: crawl the sitemap',
  })
  markContinuationJob(db, jobId, {
    primarySessionId: primary.id,
    nextStep: 'crawl the sitemap',
    continuationDepth: 1,
    checkpointedAt: now,
  })
  failPendingDelegationJob(db, jobId, 'stopped by the user', now)
  return { primaryId: primary.id, headId }
}

describe('settleOrphanedDelegationClaims — the checkpoint hand-over reconcile', () => {
  it('releases a stranded slot on the BOOT pass and says so on the thread', async () => {
    await withTestDatabase(async (db) => {
      const { primaryId, headId } = await seedStrandedHandOver(db)

      const settled = settleOrphanedDelegationClaims(db, logger, {})

      expect(settled.releasedCheckpoints).toBe(1)
      expect(peekPendingCheckpoint(db, primaryId)).toBeNull()
      expect(listRecentChatMessagesForSession(db, headId, 5).map((m) => m.body)).toEqual([
        composeDroppedCheckpointNote('crawl the sitemap', 'left-behind'),
      ])
    })
  })

  it('releases it on the LEASE SWEEP too — one policy, two readers', async () => {
    await withTestDatabase(async (db) => {
      const { primaryId } = await seedStrandedHandOver(db)

      expect(
        settleOrphanedDelegationClaims(db, logger, { onlyExpiredLeases: true }).releasedCheckpoints,
      ).toBe(1)
      expect(peekPendingCheckpoint(db, primaryId)).toBeNull()
    })
  })
})
