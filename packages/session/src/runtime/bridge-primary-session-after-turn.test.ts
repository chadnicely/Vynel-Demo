// Integration tests for the session-tier swap composition — real SQLite, fake
// provider (no live SDK). Proves the full primary-as-thread boundary swap:
// distill → mint a fresh seeded session → record it as a browsable chat segment
// → repoint the primary (record superseded) → emit session.swapped — and that a
// non-pressured turn does none of it. The carry-fidelity + live recall are
// proven separately by the live swap smoke (build brief Slice 1 §6).

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { insertPrimarySession, findPrimarySessionById } from '../repositories/index.js'
import {
  findChatSessionById,
  listChatSessionsForWorkspace,
  insertChatSession,
} from '@vynel/chat/repositories'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { SESSION_SWAPPED_EVENT_TYPE } from '../continuity/index.js'
import { FakeAiAgentProvider } from './test-support/fake-ai-agent-provider.js'
import { bridgePrimarySessionAfterTurn } from './bridge-primary-session-after-turn.js'
import { applyPrimaryTurnContinuity } from './apply-primary-turn-continuity.js'

function makeUser() {
  const now = new Date()
  return {
    id: randomUUID(),
    displayName: 'T',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  }
}

function makeWorkspace(userId: string) {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    name: 'WS',
    kind: 'personal' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }
}

function seedPrimary(
  db: Parameters<typeof insertPrimarySession>[0],
  userId: string,
  workspaceId: string,
  currentSdkSessionId: string | null,
) {
  const now = new Date()
  return insertPrimarySession(db, {
    id: randomUUID(),
    userId,
    workspaceId,
    currentSdkSessionId,
    supersededFromSdkSessionId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  })
}

const HIGH_OCCUPANCY = { usedTokens: 190_000, contextWindow: 200_000 } // ratio 0.95 > 0.85
const LOW_OCCUPANCY = { usedTokens: 10_000, contextWindow: 200_000 } // ratio 0.05

describe('bridgePrimarySessionAfterTurn', () => {
  it('under pressure: swaps to a fresh seeded segment, repoints the primary, emits session.swapped', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const primary = seedPrimary(db, user.id, workspace.id, 'sdk-old')
      const provider = new FakeAiAgentProvider({
        seededSessionId: 'sdk-fresh',
        summary: 'GOAL: ship. FACTS: codename BLUEHERON.',
      })

      const result = await bridgePrimarySessionAfterTurn(
        db,
        {
          primarySessionId: primary.id,
          userId: user.id,
          workspaceId: workspace.id,
          workspacePath: workspace.path,
          providerId: 'claude',
          measurement: HIGH_OCCUPANCY,
        },
        { provider },
      )

      expect(result?.fromSdkSessionId).toBe('sdk-old')
      expect(result?.toSdkSessionId).toBe('sdk-fresh')

      // Primary repointed to the fresh session; superseded recorded.
      const reloaded = findPrimarySessionById(db, primary.id)
      expect(reloaded?.currentSdkSessionId).toBe('sdk-fresh')
      expect(reloaded?.supersededFromSdkSessionId).toBe('sdk-old')

      // The fresh session is a recorded, empty chat segment — HIDDEN from the
      // curated sidebar (Slice 2) but browsable + present with includeHidden.
      const segment = findChatSessionById(db, 'sdk-fresh')
      expect(segment?.totalMessageCount).toBe(0)
      expect(segment?.visibility).toBe('hidden')
      // The continuity chain link — the sessions panel's A ──▶ B edge.
      expect(segment?.continuedFromSessionId).toBe('sdk-old')
      expect(listChatSessionsForWorkspace(db, workspace.id).map((s) => s.id)).not.toContain(
        'sdk-fresh',
      )
      expect(
        listChatSessionsForWorkspace(db, workspace.id, { includeHidden: true }).map((s) => s.id),
      ).toContain('sdk-fresh')

      // session.swapped emitted for the future monitor.
      expect(listOutboxEventsByType(db, SESSION_SWAPPED_EVENT_TYPE)).toHaveLength(1)
    })
  })

  it('not under pressure: no swap, no fresh segment, primary unchanged', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const primary = seedPrimary(db, user.id, workspace.id, 'sdk-old')
      const provider = new FakeAiAgentProvider({ seededSessionId: 'sdk-fresh', summary: 'x' })

      const result = await bridgePrimarySessionAfterTurn(
        db,
        {
          primarySessionId: primary.id,
          userId: user.id,
          workspaceId: workspace.id,
          workspacePath: workspace.path,
          providerId: 'claude',
          measurement: LOW_OCCUPANCY,
        },
        { provider },
      )

      expect(result).toBeNull()
      expect(findPrimarySessionById(db, primary.id)?.currentSdkSessionId).toBe('sdk-old')
      expect(findChatSessionById(db, 'sdk-fresh')).toBeNull()
      expect(listOutboxEventsByType(db, SESSION_SWAPPED_EVENT_TYPE)).toHaveLength(0)
    })
  })
})

describe('applyPrimaryTurnContinuity', () => {
  it('first primary turn: links the primary + hides the first segment, no swap below pressure', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const primary = seedPrimary(db, user.id, workspace.id, null) // unlinked
      // The first primary turn created this session via the normal new-session flow
      // (visibility 'listed' by default), like handleSessionStarted would.
      const now = new Date()
      insertChatSession(db, {
        id: 'sdk-first',
        userId: user.id,
        workspaceId: workspace.id,
        providerId: 'claude',
        title: 'New session',
        isArchived: false,
        deletedAt: null,
        totalMessageCount: 1,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        startedAt: now,
        lastMessageAt: now,
        updatedAt: now,
      })
      const provider = new FakeAiAgentProvider({ seededSessionId: 'sdk-fresh', summary: 'x' })

      const result = await applyPrimaryTurnContinuity(
        db,
        {
          primarySessionId: primary.id,
          priorSdkSessionId: null,
          effectiveSdkSessionId: 'sdk-first',
          userId: user.id,
          workspaceId: workspace.id,
          workspacePath: workspace.path,
          providerId: 'claude',
          occupancyTokens: 10_000,
          model: 'claude-opus-4-8', // 1M window → ratio 0.01, no pressure
        },
        { provider },
      )

      expect(result).toBeNull() // no swap
      expect(findPrimarySessionById(db, primary.id)?.currentSdkSessionId).toBe('sdk-first') // linked
      // The first segment is hidden so the brain shows as one entry, not a
      // stray "New session" row in the curated sidebar.
      expect(findChatSessionById(db, 'sdk-first')?.visibility).toBe('hidden')
      expect(listChatSessionsForWorkspace(db, workspace.id).map((s) => s.id)).not.toContain(
        'sdk-first',
      )
    })
  })

  it('links then swaps when the linked session is over the (overridden) threshold', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const workspace = insertWorkspace(db, makeWorkspace(user.id))
      const primary = seedPrimary(db, user.id, workspace.id, 'sdk-loaded')
      const provider = new FakeAiAgentProvider({
        seededSessionId: 'sdk-fresh',
        summary: 'GOAL: continue. FACTS: x.',
      })

      const result = await applyPrimaryTurnContinuity(
        db,
        {
          primarySessionId: primary.id,
          priorSdkSessionId: 'sdk-loaded',
          effectiveSdkSessionId: 'sdk-loaded',
          userId: user.id,
          workspaceId: workspace.id,
          workspacePath: workspace.path,
          providerId: 'claude',
          occupancyTokens: 50_000, // 0.25 on a 200k window
          model: 'claude-haiku-4-5',
          threshold: 0.2, // smoke-style override: 0.25 > 0.2 → swap
        },
        { provider },
      )

      expect(result?.toSdkSessionId).toBe('sdk-fresh')
      expect(findPrimarySessionById(db, primary.id)?.currentSdkSessionId).toBe('sdk-fresh')
    })
  })
})
