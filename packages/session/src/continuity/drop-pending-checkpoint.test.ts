// A dropped checkpoint is never silent: the take and the note on the identity's
// head land together; nothing pending → nothing written; no head → the log line
// is the only trace (no throw); the note wears the continuation anchor's shape.

import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import type { Database } from '@vynel/db'
import { buildNewChatSessionRow } from '@vynel/chat'
import { findChatSessionById, insertChatSession, listRecentChatMessagesForSession } from '@vynel/chat/repositories'
import { insertPrimarySession } from '../repositories/index.js'
import { markPendingCheckpoint, peekPendingCheckpoint } from './pending-checkpoints.js'
import { composeDroppedCheckpointNote, dropPendingCheckpoint } from './drop-pending-checkpoint.js'

function seedIdentity(db: Database, options: { withHead: boolean }): { primaryId: string; headId: string } {
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
  if (options.withHead) {
    insertChatSession(
      db,
      buildNewChatSessionRow({
        sessionId: headId,
        userId: user.id,
        workspaceId: null,
        providerId: 'claude',
        startedAt: now,
        title: 'Global brain',
        scope: 'global',
        visibility: 'hidden',
      }),
    )
  }
  const primary = insertPrimarySession(db, {
    id: randomUUID(),
    userId: user.id,
    workspaceId: null,
    scope: 'global',
    currentSdkSessionId: options.withHead ? headId : null,
    supersededFromSdkSessionId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  })
  return { primaryId: primary.id, headId }
}

describe('dropPendingCheckpoint', () => {
  it('takes the checkpoint and leaves the anchor-shaped note on the head, in one go', async () => {
    await withTestDatabase((db) => {
      const { primaryId, headId } = seedIdentity(db, { withHead: true })
      const logger = { warn: vi.fn(), info: vi.fn() }
      markPendingCheckpoint(db, primaryId, 'sum the July receipts')
      const at = new Date('2026-08-19T12:00:00.000Z')

      const dropped = dropPendingCheckpoint(db, primaryId, { reason: 'turn-stopped', logger: logger as never, now: () => at })

      expect(dropped?.nextStep).toBe('sum the July receipts')
      expect(peekPendingCheckpoint(db, primaryId)).toBeNull()
      const [note] = listRecentChatMessagesForSession(db, headId, 5)
      expect(note).toMatchObject({
        sessionId: headId,
        role: 'user',
        sourceKind: 'global-root',
        sourceLabel: null,
        body: composeDroppedCheckpointNote('sum the July receipts', 'turn-stopped'),
        createdAt: at,
      })
      expect(note!.body).toBe(
        'Not continued — the next step was: sum the July receipts (the turn was stopped). Ask to continue when you want it picked up.',
      )
      expect(findChatSessionById(db, headId)?.lastMessageAt).toEqual(at)
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ primarySessionId: primaryId, nextStep: 'sum the July receipts', reason: 'turn-stopped' }),
        expect.stringContaining('checkpoint dropped'),
      )
    })
  })

  it('nothing pending → nothing dropped, nothing written, nothing logged', async () => {
    await withTestDatabase((db) => {
      const { primaryId, headId } = seedIdentity(db, { withHead: true })
      const logger = { warn: vi.fn(), info: vi.fn() }
      expect(dropPendingCheckpoint(db, primaryId, { reason: 'cap-reached', logger: logger as never })).toBeNull()
      expect(listRecentChatMessagesForSession(db, headId, 5)).toHaveLength(0)
      expect(logger.warn).not.toHaveBeenCalled()
    })
  })

  it('an identity with no head yet still drops (the log is the trace) — no throw, no orphan row', async () => {
    await withTestDatabase((db) => {
      const { primaryId } = seedIdentity(db, { withHead: false })
      markPendingCheckpoint(db, primaryId, 'x')
      expect(dropPendingCheckpoint(db, primaryId, { reason: 'left-behind' })?.nextStep).toBe('x')
      expect(peekPendingCheckpoint(db, primaryId)).toBeNull()
    })
  })

  it('names every reason in plain words', () => {
    expect(composeDroppedCheckpointNote('x', 'turn-failed')).toContain('(the turn failed)')
    expect(composeDroppedCheckpointNote('x', 'turn-cut-short')).toContain('(the turn was cut short)')
    expect(composeDroppedCheckpointNote('x', 'cap-reached')).toContain('(the automatic continuation limit was reached)')
    expect(composeDroppedCheckpointNote('x', 'delivery-turn')).toContain('(a delivery turn never continues work)')
    expect(composeDroppedCheckpointNote('x', 'left-behind')).toContain('(the run that planned it ended without continuing)')
  })
})
