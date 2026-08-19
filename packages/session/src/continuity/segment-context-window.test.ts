// The one reading of a segment's denominator + the model that grew its chain:
// the persisted window first; a legacy row falls to the window of the model
// that ran; a FRESH swap segment (nothing yet) walks its own predecessors —
// newest known wins (the fold's rule); nothing anywhere → the floor, model
// null; the walk stops at a foreign owner's row and at a cycle.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import type { Database } from '@vynel/db'
import { buildNewChatSessionRow } from '@vynel/chat'
import { insertChatSession, updateChatSession } from '@vynel/chat/repositories'
import { resolveSegmentContextWindow } from './segment-context-window.js'

function seedUser(db: Database): string {
  const now = new Date()
  return insertUser(db, {
    id: randomUUID(),
    displayName: 'T',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  }).id
}

function seedSegment(
  db: Database,
  input: {
    id: string
    userId: string
    continuedFrom?: string
    model?: string
    lastContextWindow?: number
    lastContextTokens?: number
  },
): void {
  insertChatSession(db, {
    ...buildNewChatSessionRow({
      sessionId: input.id,
      userId: input.userId,
      workspaceId: null,
      providerId: 'claude',
      startedAt: new Date(),
      title: 'Continued conversation',
      scope: 'global',
      visibility: 'hidden',
    }),
    ...(input.continuedFrom !== undefined ? { continuedFromSessionId: input.continuedFrom } : {}),
  })
  updateChatSession(db, input.id, {
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.lastContextWindow !== undefined ? { lastContextWindow: input.lastContextWindow } : {}),
    ...(input.lastContextTokens !== undefined ? { lastContextTokens: input.lastContextTokens } : {}),
  })
}

describe('resolveSegmentContextWindow', () => {
  it('reads the persisted denominator first — a small last-ran model does not lower it', async () => {
    await withTestDatabase((db) => {
      const userId = seedUser(db)
      seedSegment(db, { id: 'seg', userId, model: 'claude-haiku-4-5', lastContextWindow: 1_000_000, lastContextTokens: 150_000 })
      expect(resolveSegmentContextWindow(db, 'seg')).toEqual({ contextWindow: 1_000_000, lastRanModel: 'claude-haiku-4-5' })
    })
  })

  it('a row written before the column existed falls back to the window of the model that ran', async () => {
    await withTestDatabase((db) => {
      const userId = seedUser(db)
      seedSegment(db, { id: 'legacy', userId, model: 'claude-opus-4-8', lastContextTokens: 300_000 })
      expect(resolveSegmentContextWindow(db, 'legacy')).toEqual({ contextWindow: 1_000_000, lastRanModel: 'claude-opus-4-8' })
    })
  })

  it('a fresh swap segment (no usage, no model) answers from its chain — the newest segment that knows', async () => {
    await withTestDatabase((db) => {
      const userId = seedUser(db)
      // origin (haiku, legacy) → middle (opus, 1M written) → fresh head (nothing yet).
      seedSegment(db, { id: 'origin', userId, model: 'claude-haiku-4-5', lastContextTokens: 100_000 })
      seedSegment(db, { id: 'middle', userId, continuedFrom: 'origin', model: 'claude-opus-4-8', lastContextWindow: 1_000_000, lastContextTokens: 900_000 })
      seedSegment(db, { id: 'fresh', userId, continuedFrom: 'middle' })
      expect(resolveSegmentContextWindow(db, 'fresh')).toEqual({ contextWindow: 1_000_000, lastRanModel: 'claude-opus-4-8' })
      // The window and the model may come from different segments — a fresh
      // segment that only got the copied-forward window still names the model
      // that grew the chain.
      seedSegment(db, { id: 'fresh-with-window', userId, continuedFrom: 'middle', lastContextWindow: 1_000_000 })
      expect(resolveSegmentContextWindow(db, 'fresh-with-window')).toEqual({ contextWindow: 1_000_000, lastRanModel: 'claude-opus-4-8' })
    })
  })

  it('nothing known anywhere → the floor and no model; an unknown segment likewise', async () => {
    await withTestDatabase((db) => {
      const userId = seedUser(db)
      seedSegment(db, { id: 'blank', userId })
      expect(resolveSegmentContextWindow(db, 'blank')).toEqual({ contextWindow: 200_000, lastRanModel: null })
      expect(resolveSegmentContextWindow(db, 'absent')).toEqual({ contextWindow: 200_000, lastRanModel: null })
    })
  })

  it('stops at a foreign owner and at a cycle — never reads a stranger, never spins', async () => {
    await withTestDatabase((db) => {
      const mine = seedUser(db)
      const theirs = seedUser(db)
      seedSegment(db, { id: 'their-seg', userId: theirs, model: 'claude-opus-4-8', lastContextWindow: 1_000_000 })
      seedSegment(db, { id: 'my-fresh', userId: mine, continuedFrom: 'their-seg' })
      expect(resolveSegmentContextWindow(db, 'my-fresh')).toEqual({ contextWindow: 200_000, lastRanModel: null })

      seedSegment(db, { id: 'loop-a', userId: mine })
      seedSegment(db, { id: 'loop-b', userId: mine, continuedFrom: 'loop-a' })
      updateChatSession(db, 'loop-a', { continuedFromSessionId: 'loop-b' })
      expect(resolveSegmentContextWindow(db, 'loop-b')).toEqual({ contextWindow: 200_000, lastRanModel: null })
    })
  })
})
