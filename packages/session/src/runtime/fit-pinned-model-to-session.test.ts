import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import type { Database } from '@vynel/db'
import { insertChatSession, updateChatSession } from '@vynel/chat/repositories'
import { buildNewChatSessionRow } from '@vynel/chat'
import { fitPinnedModelToSession } from './fit-pinned-model-to-session.js'

const USER_ID = 'user-fit'
const SESSION_ID = 'session-fit'
const PIN = 'claude-haiku-4-5' // 200k window

function seedSession(
  db: Database,
  row: { lastContextTokens?: number; model?: string; lastContextWindow?: number },
): void {
  const now = new Date()
  insertUser(db, {
    id: USER_ID,
    displayName: 'Fit',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  })
  insertChatSession(
    db,
    buildNewChatSessionRow({
      sessionId: SESSION_ID,
      userId: USER_ID,
      workspaceId: null,
      providerId: 'claude',
      startedAt: new Date(),
      title: 'Global brain',
      scope: 'global',
    }),
  )
  updateChatSession(db, SESSION_ID, {
    ...(row.lastContextTokens !== undefined ? { lastContextTokens: row.lastContextTokens } : {}),
    ...(row.model !== undefined ? { model: row.model } : {}),
    ...(row.lastContextWindow !== undefined ? { lastContextWindow: row.lastContextWindow } : {}),
  })
}

// A fresh swap segment chained onto SESSION_ID: no usage, no model of its own.
function seedFreshSwapSegment(db: Database, sessionId: string): void {
  insertChatSession(db, {
    ...buildNewChatSessionRow({
      sessionId,
      userId: USER_ID,
      workspaceId: null,
      providerId: 'claude',
      startedAt: new Date(),
      title: 'Continued conversation',
      scope: 'global',
      visibility: 'hidden',
    }),
    continuedFromSessionId: SESSION_ID,
  })
}

describe('fitPinnedModelToSession', () => {
  it('keeps the pin when the occupancy fits its window', async () => {
    await withTestDatabase((db) => {
      seedSession(db, { lastContextTokens: 50_000, model: 'claude-fable-5' })
      const fit = fitPinnedModelToSession(db, { resumeSdkSessionId: SESSION_ID, pinnedModel: PIN })
      expect(fit).toEqual({ model: PIN, wasReplaced: false, occupancyTokens: 50_000 })
    })
  })

  it('falls back to the segment last-ran model when the pin cannot hold the occupancy (the 2026-08-19 voice incident)', async () => {
    await withTestDatabase((db) => {
      seedSession(db, { lastContextTokens: 442_846, model: 'claude-fable-5' })
      const fit = fitPinnedModelToSession(db, { resumeSdkSessionId: SESSION_ID, pinnedModel: PIN })
      expect(fit).toEqual({
        model: 'claude-fable-5',
        wasReplaced: true,
        occupancyTokens: 442_846,
      })
    })
  })

  it('yields the engine default (undefined) when even the last-ran model is unknown or unfit — the poisoned <synthetic> row', async () => {
    await withTestDatabase((db) => {
      seedSession(db, { lastContextTokens: 442_846, model: '<synthetic>' })
      const fit = fitPinnedModelToSession(db, { resumeSdkSessionId: SESSION_ID, pinnedModel: PIN })
      expect(fit).toEqual({ model: undefined, wasReplaced: true, occupancyTokens: 442_846 })
    })
  })

  it('a fresh swap segment that has not run yet falls back to the model that grew its CHAIN, not the engine default', async () => {
    await withTestDatabase((db) => {
      // The predecessor grew under fable (1M); the fresh head has nothing of its own.
      seedSession(db, { lastContextTokens: 442_846, model: 'claude-fable-5', lastContextWindow: 1_000_000 })
      seedFreshSwapSegment(db, 'session-fresh')
      // Nothing measured on the fresh head → the pin fits (0 tokens) — the guard
      // is about THIS segment's occupancy.
      expect(fitPinnedModelToSession(db, { resumeSdkSessionId: 'session-fresh', pinnedModel: PIN })).toEqual({
        model: PIN,
        wasReplaced: false,
        occupancyTokens: 0,
      })
      // Once the fresh head has grown past the pin (its usage written, its model
      // still unreported — the mid-turn split), the fallback is the chain's model.
      updateChatSession(db, 'session-fresh', { lastContextTokens: 180_000 })
      expect(fitPinnedModelToSession(db, { resumeSdkSessionId: 'session-fresh', pinnedModel: PIN })).toEqual({
        model: 'claude-fable-5',
        wasReplaced: true,
        occupancyTokens: 180_000,
      })
    })
  })

  it('treats a missing row / never-measured session as fitting (occupancy 0)', async () => {
    await withTestDatabase((db) => {
      const fit = fitPinnedModelToSession(db, { resumeSdkSessionId: 'absent', pinnedModel: PIN })
      expect(fit).toEqual({ model: PIN, wasReplaced: false, occupancyTokens: 0 })
    })
  })

  it('honors the threshold override — the same knob the boundary swap reads', async () => {
    await withTestDatabase((db) => {
      // 100k of a 200k pin: fine at 0.85, past a lowered 0.4 smoke threshold.
      seedSession(db, { lastContextTokens: 100_000, model: 'claude-fable-5' })
      const fit = fitPinnedModelToSession(db, {
        resumeSdkSessionId: SESSION_ID,
        pinnedModel: PIN,
        threshold: 0.4,
      })
      expect(fit.wasReplaced).toBe(true)
      expect(fit.model).toBe('claude-fable-5')
    })
  })
})
