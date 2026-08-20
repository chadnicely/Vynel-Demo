// The RESTART SURVIVOR (audit r2 R2-H). Real SQLite: a checkpoint that
// outlived the process must become VISIBLE at boot (never auto-run — Kafi
// 2026-08-20), must reach the next turn's model as a marker, and must never be
// overwritten in silence. The spoken thread never continues work by itself, so
// its survivor is given up instead of promised.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import type { Database } from '@vynel/db'
import { buildNewChatSessionRow } from '@vynel/chat'
import { insertChatSession, listRecentChatMessagesForSession } from '@vynel/chat/repositories'
import { insertPrimarySession, type PrimarySessionScope } from '../repositories/index.js'
import { markPendingCheckpoint, peekPendingCheckpoint } from './pending-checkpoints.js'
import { composeDroppedCheckpointNote } from './drop-pending-checkpoint.js'
import {
  composeSurvivedCheckpointNote,
  recordCheckpointSupersedingSurvivor,
  resolveSurvivorCheckpointMarker,
  surfaceCheckpointSurvivors,
} from './checkpoint-survivors.js'

const BEFORE_THIS_LIFE = new Date('2026-08-19T10:00:00Z')
const THIS_LIFE = new Date('2026-08-20T10:00:00Z')

function seedIdentity(
  db: Database,
  scope: PrimarySessionScope = 'global',
): { primaryId: string; headId: string } {
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
  const headId = `sdk-${randomUUID()}`
  insertChatSession(
    db,
    buildNewChatSessionRow({
      sessionId: headId,
      userId: user.id,
      workspaceId: null,
      providerId: 'claude',
      startedAt: now,
      title: scope === 'voice' ? 'Voice' : 'Global brain',
      scope: 'global',
      visibility: 'hidden',
    }),
  )
  const primary = insertPrimarySession(db, {
    id: randomUUID(),
    userId: user.id,
    workspaceId: null,
    scope,
    currentSdkSessionId: headId,
    supersededFromSdkSessionId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  })
  return { primaryId: primary.id, headId }
}

function bodiesOn(db: Database, sessionId: string): string[] {
  return listRecentChatMessagesForSession(db, sessionId, 20).map((message) => message.body)
}

describe('surfaceCheckpointSurvivors — the boot pass', () => {
  it('announces a survivor on its own thread and LEAVES it pending (Vynel never starts work at boot)', async () => {
    await withTestDatabase((db) => {
      const { primaryId, headId } = seedIdentity(db)
      markPendingCheckpoint(db, primaryId, 'wire the retry path', { now: () => BEFORE_THIS_LIFE })

      expect(surfaceCheckpointSurvivors(db)).toEqual({ surfaced: 1, dropped: 0 })

      expect(bodiesOn(db, headId)).toEqual([composeSurvivedCheckpointNote('wire the retry path')])
      // Still owed — the next turn's marker + the continuation loop pick it up.
      expect(peekPendingCheckpoint(db, primaryId)?.nextStep).toBe('wire the retry path')
    })
  })

  it('is idempotent — three restarts before the user says anything leave ONE note', async () => {
    await withTestDatabase((db) => {
      const { primaryId, headId } = seedIdentity(db)
      markPendingCheckpoint(db, primaryId, 'finish the migration', { now: () => BEFORE_THIS_LIFE })

      expect(surfaceCheckpointSurvivors(db).surfaced).toBe(1)
      // The count follows the rows: a pass that wrote nothing says so.
      expect(surfaceCheckpointSurvivors(db).surfaced).toBe(0)
      expect(surfaceCheckpointSurvivors(db).surfaced).toBe(0)

      expect(bodiesOn(db, headId)).toHaveLength(1)
    })
  })

  it('DROPS the spoken thread’s survivor — that thread never continues work, so nothing may be promised', async () => {
    await withTestDatabase((db) => {
      const { primaryId, headId } = seedIdentity(db, 'voice')
      markPendingCheckpoint(db, primaryId, 'read the second file', { now: () => BEFORE_THIS_LIFE })

      expect(surfaceCheckpointSurvivors(db)).toEqual({ surfaced: 0, dropped: 1 })

      expect(bodiesOn(db, headId)).toEqual([
        composeDroppedCheckpointNote('read the second file', 'restarted'),
      ])
      expect(peekPendingCheckpoint(db, primaryId)).toBeNull()
    })
  })

  it('writes nothing when no identity owes a step', async () => {
    await withTestDatabase((db) => {
      const { headId } = seedIdentity(db)
      expect(surfaceCheckpointSurvivors(db)).toEqual({ surfaced: 0, dropped: 0 })
      expect(bodiesOn(db, headId)).toEqual([])
    })
  })
})

describe('resolveSurvivorCheckpointMarker — the next turn’s provider input', () => {
  it('names the owed step, and is null once the checkpoint is consumed', async () => {
    await withTestDatabase((db) => {
      const { primaryId } = seedIdentity(db)
      expect(resolveSurvivorCheckpointMarker(db, primaryId)).toBeNull()

      markPendingCheckpoint(db, primaryId, 'run the smoke', { now: () => BEFORE_THIS_LIFE })
      const marker = resolveSurvivorCheckpointMarker(db, primaryId)
      expect(marker).toContain('run the smoke')
      expect(marker).toContain('do NOT redo that step here')
    })
  })
})

describe('recordCheckpointSupersedingSurvivor — overwrite is never silent', () => {
  it('gives a SURVIVOR up out loud before the new intent lands', async () => {
    await withTestDatabase((db) => {
      const { primaryId, headId } = seedIdentity(db)
      markPendingCheckpoint(db, primaryId, 'the old step', { now: () => BEFORE_THIS_LIFE })

      recordCheckpointSupersedingSurvivor(db, primaryId, 'the new step', {
        survivorBefore: THIS_LIFE,
        now: () => THIS_LIFE,
      })

      expect(bodiesOn(db, headId)).toEqual([
        composeDroppedCheckpointNote('the old step', 'superseded'),
      ])
      expect(peekPendingCheckpoint(db, primaryId)?.nextStep).toBe('the new step')
    })
  })

  it('replaces a SAME-LIFE checkpoint quietly — a model refining its own next step is not news', async () => {
    await withTestDatabase((db) => {
      const { primaryId, headId } = seedIdentity(db)
      recordCheckpointSupersedingSurvivor(db, primaryId, 'first take', {
        survivorBefore: BEFORE_THIS_LIFE,
        now: () => THIS_LIFE,
      })
      recordCheckpointSupersedingSurvivor(db, primaryId, 'second take', {
        survivorBefore: BEFORE_THIS_LIFE,
        now: () => THIS_LIFE,
      })

      expect(bodiesOn(db, headId)).toEqual([])
      expect(peekPendingCheckpoint(db, primaryId)?.nextStep).toBe('second take')
    })
  })
})
