// Tests for `getSessionsOverview` — chain folding, fork-B surfacing, the
// hidden-chain doorway rule, isCurrent, sort + tenancy. Real SQLite.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  insertChatSession,
  updateChatSession,
  type NewChatSession,
} from '@vynel/chat/repositories'
import {
  getOrCreatePrimarySession,
  linkPrimarySessionToSdkSession,
} from '../continuity/index.js'
import { getSessionsOverview } from './get-sessions-overview.js'

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

function makeWorkspace(userId: string, name = 'Acme') {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    name,
    kind: 'personal' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }
}

function makeSession(
  userId: string,
  workspaceId: string | null,
  overrides: Partial<NewChatSession> = {},
): NewChatSession {
  const now = new Date('2026-07-01T00:00:00Z')
  return {
    id: `sdk-${randomUUID()}`,
    userId,
    workspaceId,
    providerId: 'claude',
    title: 'A conversation',
    visibility: 'listed',
    scope: 'workspace',
    isArchived: false,
    deletedAt: null,
    totalMessageCount: 1,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    startedAt: now,
    lastMessageAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('getSessionsOverview', () => {
  it('folds a continuity chain into ONE entry keyed by its newest segment', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const ws = insertWorkspace(db, makeWorkspace(user.id))

      const head = insertChatSession(
        db,
        makeSession(user.id, ws.id, {
          title: 'Fix the build',
          model: 'claude-opus-4-8',
          lastContextTokens: 170_000,
          lastMessageAt: new Date('2026-07-01T10:00:00Z'),
        }),
      )
      const tail = insertChatSession(
        db,
        makeSession(user.id, ws.id, {
          title: 'Continued conversation',
          visibility: 'hidden',
          model: 'claude-opus-4-8',
          lastContextTokens: 12_000,
          continuedFromSessionId: head.id,
          lastMessageAt: new Date('2026-07-01T11:00:00Z'),
        }),
      )

      const entries = getSessionsOverview(db, { userId: user.id })
      expect(entries).toHaveLength(1)
      const entry = entries[0]!
      // The entry IS the conversation: newest segment's id, the real title
      // (never the swap stock title), the CURRENT occupancy, the chain inside.
      expect(entry.sessionId).toBe(tail.id)
      expect(entry.title).toBe('Fix the build')
      expect(entry.workspaceName).toBe('Acme')
      expect(entry.contextTokens).toBe(12_000)
      expect(entry.contextWindow).toBe(1_000_000) // opus-4-8 per resolveContextWindow
      expect(entry.segments.map((segment) => segment.sessionId)).toEqual([head.id, tail.id])
      // The fork label derives from the predecessor's persisted occupancy.
      expect(entry.segments[0]!.contextTokens).toBe(170_000)
      expect(entry.segments[1]!.continuedFromSessionId).toBe(head.id)
    })
  })

  it('surfaces the all-hidden GLOBAL chain as the "Assistant" entry (fork B)', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      insertChatSession(
        db,
        makeSession(user.id, null, {
          title: 'Global brain',
          scope: 'global',
          visibility: 'hidden',
          lastContextTokens: 40_000,
        }),
      )

      const entries = getSessionsOverview(db, { userId: user.id })
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({
        scope: 'global',
        title: 'Assistant',
        workspaceId: null,
        workspaceName: null,
        contextTokens: 40_000,
      })
    })
  })

  it('skips a WORKSPACE chain hidden end to end (no user-facing doorway)', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const ws = insertWorkspace(db, makeWorkspace(user.id))
      insertChatSession(
        db,
        makeSession(user.id, ws.id, { visibility: 'hidden', title: 'Continued conversation' }),
      )

      expect(getSessionsOverview(db, { userId: user.id })).toHaveLength(0)
    })
  })

  it('marks the segment a live primary points at as isCurrent', async () => {
    await withTestDatabase(async (db) => {
      const user = insertUser(db, makeUser())
      const ws = insertWorkspace(db, makeWorkspace(user.id))
      const session = insertChatSession(db, makeSession(user.id, ws.id))
      const primary = await getOrCreatePrimarySession(db, { userId: user.id, workspaceId: ws.id })
      linkPrimarySessionToSdkSession(db, {
        primarySessionId: primary.id,
        userId: user.id,
        sdkSessionId: session.id,
      })

      const entries = getSessionsOverview(db, { userId: user.id })
      expect(entries[0]!.segments[0]!.isCurrent).toBe(true)
    })
  })

  it('sorts by last use (newest first) and never leaks another tenant', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const otherUser = insertUser(db, makeUser())
      const ws = insertWorkspace(db, makeWorkspace(user.id))
      const otherWs = insertWorkspace(db, makeWorkspace(otherUser.id))

      insertChatSession(
        db,
        makeSession(user.id, ws.id, {
          title: 'Older',
          lastMessageAt: new Date('2026-07-01T09:00:00Z'),
        }),
      )
      insertChatSession(
        db,
        makeSession(user.id, ws.id, {
          title: 'Newer',
          lastMessageAt: new Date('2026-07-02T09:00:00Z'),
        }),
      )
      insertChatSession(db, makeSession(otherUser.id, otherWs.id, { title: 'Not yours' }))

      const entries = getSessionsOverview(db, { userId: user.id })
      expect(entries.map((entry) => entry.title)).toEqual(['Newer', 'Older'])
    })
  })

  it('CORRUPTION: two children claiming one parent — the NEWEST wins the chain (the live segment survives)', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const ws = insertWorkspace(db, makeWorkspace(user.id))
      const head = insertChatSession(
        db,
        makeSession(user.id, ws.id, {
          title: 'Original',
          lastMessageAt: new Date('2026-07-01T09:00:00Z'),
        }),
      )
      // A crashed double swap: two segments claim the same predecessor.
      insertChatSession(
        db,
        makeSession(user.id, ws.id, {
          title: 'Stale twin',
          visibility: 'hidden',
          continuedFromSessionId: head.id,
          lastMessageAt: new Date('2026-07-01T10:00:00Z'),
        }),
      )
      const liveTwin = insertChatSession(
        db,
        makeSession(user.id, ws.id, {
          title: 'Continued conversation',
          visibility: 'hidden',
          continuedFromSessionId: head.id,
          lastMessageAt: new Date('2026-07-01T11:00:00Z'),
        }),
      )

      const entries = getSessionsOverview(db, { userId: user.id })
      expect(entries).toHaveLength(1)
      // The chain walks head → the NEWEST claimant; the stale twin drops.
      expect(entries[0]!.sessionId).toBe(liveTwin.id)
      expect(entries[0]!.segments).toHaveLength(2)
    })
  })

  it('CORRUPTION: a cycle terminates the fold (silent omission, no hang)', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const ws = insertWorkspace(db, makeWorkspace(user.id))
      // A ↔ B: both have in-window parents, so neither is a head — the pair
      // silently drops; an unrelated healthy session still lists.
      const a = insertChatSession(db, makeSession(user.id, ws.id, { title: 'Cycle A' }))
      const b = insertChatSession(
        db,
        makeSession(user.id, ws.id, { title: 'Cycle B', continuedFromSessionId: a.id }),
      )
      updateChatSession(db, a.id, { continuedFromSessionId: b.id })
      insertChatSession(db, makeSession(user.id, ws.id, { title: 'Healthy' }))

      const entries = getSessionsOverview(db, { userId: user.id })
      expect(entries.map((entry) => entry.title)).toEqual(['Healthy'])
    })
  })

  it('a pruned predecessor makes the surviving segment a chain head (no crash)', async () => {
    await withTestDatabase((db) => {
      const user = insertUser(db, makeUser())
      const ws = insertWorkspace(db, makeWorkspace(user.id))
      const orphan = insertChatSession(
        db,
        makeSession(user.id, ws.id, {
          title: 'Survivor',
          continuedFromSessionId: `sdk-${randomUUID()}`, // predecessor purged
        }),
      )

      const entries = getSessionsOverview(db, { userId: user.id })
      expect(entries).toHaveLength(1)
      expect(entries[0]!.sessionId).toBe(orphan.id)
      expect(entries[0]!.segments).toHaveLength(1)
    })
  })
})
