// `handleSessionStarted` — the mid-turn compaction-swap branch (session-review
// B4): a resumed turn whose provider reports a DIFFERENT session id with no row
// must create a CHAINED continuation segment (predecessor link + swap-segment
// presentation + inherited scope), never an orphaned "New session" default row.
// Explicit newSessionOptions keep winning (the agent/spawned delegate paths).

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import type { Database } from '@vynel/db'
import { findChatSessionById, insertChatSession } from '../repositories/index.js'
import { buildNewChatSessionRow } from './build-new-chat-session-row.js'
import { handleSessionStarted } from './handle-session-started.js'
import { updateChatSessionSettings } from '../settings/update-chat-session-settings.js'

function seedUser(db: Database) {
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
  })
}

function seedSpawnedSegment(db: Database, userId: string, sessionId: string) {
  insertChatSession(
    db,
    buildNewChatSessionRow({
      sessionId,
      userId,
      workspaceId: null,
      providerId: 'claude',
      startedAt: new Date(),
      title: 'July run',
      visibility: 'listed',
      scope: 'spawned',
    }),
  )
}

function swapInput(db: Database, userId: string, overrides: object = {}) {
  return {
    db,
    event: {
      kind: 'session-started' as const,
      sessionId: 'sdk-new',
      resumedFromExisting: false,
      startedAt: new Date(),
    },
    userMessageInput: { id: randomUUID(), body: 'keep going', attachedImagesMetadata: null },
    userId,
    workspaceId: null,
    providerId: 'claude' as const,
    isNewSession: false,
    resumeSessionId: 'sdk-old',
    ...overrides,
  }
}

describe('handleSessionStarted — mid-turn swap (B4)', () => {
  it('chains the swap row to its predecessor and inherits its scope + the swap presentation', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      seedSpawnedSegment(db, user.id, 'sdk-old')

      const result = handleSessionStarted(swapInput(db, user.id))
      expect(result.sessionId).toBe('sdk-new')

      const row = findChatSessionById(db, 'sdk-new')!
      // The chain link — without it the segment is an orphan: the overview
      // can't fold it and the global transcript loses pre-swap history.
      expect(row.continuedFromSessionId).toBe('sdk-old')
      // Scope inherited from the predecessor — a spawned continuation must
      // never default to 'global' (the phantom "Assistant" entry).
      expect(row.scope).toBe('spawned')
      // The swap-segment presentation (the recordSwapSegmentSession convention).
      expect(row.visibility).toBe('hidden')
      expect(row.title).toBe('Continued conversation')
    })
  })

  it('explicit newSessionOptions still win over the swap defaults', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      seedSpawnedSegment(db, user.id, 'sdk-old')

      handleSessionStarted(
        swapInput(db, user.id, {
          newSessionOptions: { visibility: 'hidden', title: 'Custom title', scope: 'agent' },
        }),
      )

      const row = findChatSessionById(db, 'sdk-new')!
      expect(row.continuedFromSessionId).toBe('sdk-old')
      expect(row.scope).toBe('agent')
      expect(row.title).toBe('Custom title')
    })
  })

  it('a genuinely NEW session stays byte-for-byte unchained (no link, defaults intact)', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)

      handleSessionStarted(
        swapInput(db, user.id, {
          event: {
            kind: 'session-started' as const,
            sessionId: 'sdk-fresh',
            resumedFromExisting: false,
            startedAt: new Date(),
          },
          isNewSession: true,
          resumeSessionId: undefined,
        }),
      )

      const row = findChatSessionById(db, 'sdk-fresh')!
      expect(row.continuedFromSessionId).toBeNull()
      expect(row.title).toBe('New session')
      expect(row.visibility).toBe('listed')
      expect(row.scope).toBe('global')
    })
  })

  it('inherits the predecessor’s composer settings (a mid-turn swap never resets them)', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      seedSpawnedSegment(db, user.id, 'sdk-old')
      updateChatSessionSettings(db, 'sdk-old', {
        sessionMode: 'auto',
        selectedModel: 'claude-sonnet-5',
        thinkingEffort: 'medium',
        autoBuildout: true,
      })

      handleSessionStarted(swapInput(db, user.id))

      const row = findChatSessionById(db, 'sdk-new')!
      expect(row.sessionMode).toBe('auto')
      expect(row.selectedModel).toBe('claude-sonnet-5')
      expect(row.thinkingEffort).toBe('medium')
      expect(row.autoBuildout).toBe(true)
    })
  })

  it('a vanished predecessor still chains the row (scope falls to derivation)', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      // No 'sdk-old' row exists at all — the defensive worst case.

      handleSessionStarted(swapInput(db, user.id))

      const row = findChatSessionById(db, 'sdk-new')!
      expect(row.continuedFromSessionId).toBe('sdk-old')
      expect(row.visibility).toBe('hidden')
      expect(row.scope).toBe('global')
    })
  })
})
