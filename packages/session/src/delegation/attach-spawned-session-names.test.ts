// Tests for `attachSpawnedSessionNames` (sessions-surface Slice ④) — the
// serve-time enrichment that names a SESSION-target job's processing chip.
// Real SQLite; a spawned session seeded through the real create rails so the
// listed first segment (the name's home) is faithful.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import type { Database } from '@vynel/db'
import { insertUser } from '@vynel/db/repositories/users'
import { FakeAiAgentProvider } from '../runtime/test-support/fake-ai-agent-provider.js'
import { createSpawnedSession } from '../spawned/index.js'
import { insertPrimarySession } from '../repositories/index.js'
import { attachSpawnedSessionNames } from './attach-spawned-session-names.js'
import { recordSwapSegmentSession } from '@vynel/chat'
import { linkPrimarySessionToSdkSession } from '../continuity/index.js'

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

async function seedSpawnedSession(db: Database, userId: string) {
  return createSpawnedSession(db, new FakeAiAgentProvider({ seededSessionId: 'sdk-spawned-1' }), {
    userId,
    name: 'Research: pricing',
    purpose: 'compare pricing pages',
    workspacePath: '/tmp/vynel/global-root',
  })
}

describe('attachSpawnedSessionNames', () => {
  it("names a session-target row by the spawned session's listed segment; workspace rows stay null", async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const created = await seedSpawnedSession(db, user.id)

      const enriched = attachSpawnedSessionNames(db, [
        { targetPrimarySessionId: created.primarySessionId, taskLabel: 'compare' },
        { targetPrimarySessionId: null, taskLabel: 'workspace work' },
      ])

      expect(enriched[0]).toMatchObject({
        sessionName: 'Research: pricing',
        taskLabel: 'compare', // the input row passes through untouched
      })
      expect(enriched[1]).toMatchObject({ sessionName: null })
    })
  })

  it("falls back to 'Session' when the target's name can't be read (unlinked or gone)", async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      // A primary that never linked a segment — nothing carries a title yet.
      const now = new Date()
      const unlinked = insertPrimarySession(db, {
        id: randomUUID(),
        userId: user.id,
        workspaceId: null,
        scope: 'spawned',
        currentSdkSessionId: null,
        supersededFromSdkSessionId: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })

      const enriched = attachSpawnedSessionNames(db, [
        { targetPrimarySessionId: unlinked.id },
        // The primary row itself is gone (pruned/corrupt ref) — same fallback.
        { targetPrimarySessionId: randomUUID() },
      ])

      expect(enriched[0]!.sessionName).toBe('Session')
      expect(enriched[1]!.sessionName).toBe('Session')
    })
  })

  it('keeps naming the session from its LISTED identity row after a continuity swap moved the head', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const created = await seedSpawnedSession(db, user.id)
      // A boundary swap: a hidden "Continued conversation" segment chained to
      // the identity row becomes the head. The name must not follow it.
      recordSwapSegmentSession(db, {
        sessionId: 'sdk-spawned-2',
        userId: user.id,
        workspaceId: null,
        providerId: 'claude',
        continuedFromSessionId: created.sessionId,
      })
      linkPrimarySessionToSdkSession(db, {
        primarySessionId: created.primarySessionId,
        userId: user.id,
        sdkSessionId: 'sdk-spawned-2',
      })

      const enriched = attachSpawnedSessionNames(db, [
        { targetPrimarySessionId: created.primarySessionId, taskLabel: 'compare' },
      ])
      expect(enriched[0]).toMatchObject({ sessionName: 'Research: pricing' })
    })
  })
})
