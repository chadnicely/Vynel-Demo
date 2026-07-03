// Repository tests for the `chat_sessions` table. Real SQLite via
// `@vynel/testing`'s `withTestDatabase` (no DB mocking).
// Spec: `docs/blueprints/chat/blueprint.md §4.1` + coding §8.1.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  findChatSessionById,
  listChatSessionsForWorkspace,
  insertChatSession,
  updateChatSession,
  incrementChatSessionCounters,
  softDeleteChatSession,
  listChatSessionsDeletedBefore,
  hardDeleteChatSession,
  type NewChatSession,
} from './chat-sessions.js'
import { insertChatMessage } from './chat-messages.js'

function makeUser(id: string = randomUUID()) {
  return {
    id,
    displayName: 'Test User',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

function makeWorkspace(userId: string) {
  const now = new Date()
  return {
    id: randomUUID(),
    userId,
    name: 'Acme',
    kind: 'small-business' as const,
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  }
}

function makeChatSession(
  userId: string,
  workspaceId: string,
  overrides: Partial<NewChatSession> = {},
): NewChatSession {
  const now = new Date()
  return {
    id: `session-${randomUUID()}`,
    userId,
    workspaceId,
    providerId: 'claude',
    title: 'New session',
    isArchived: false,
    deletedAt: null,
    totalMessageCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    startedAt: now,
    lastMessageAt: now,
    updatedAt: now,
    ...overrides,
  }
}

async function seed(): Promise<{
  user: ReturnType<typeof makeUser>
  workspace: ReturnType<typeof makeWorkspace>
}> {
  // intentionally async-shaped; callers use it inside withTestDatabase
  throw new Error('unused — see withTestDatabase callbacks below')
}
// `seed` shape kept for IDE discovery; real seeding is inline below.
void seed

describe('chatSessions repository', () => {
  it('findChatSessionById returns the row when present', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const workspace = makeWorkspace(user.id)
      insertWorkspace(db, workspace)
      const inserted = insertChatSession(db, makeChatSession(user.id, workspace.id))
      expect(findChatSessionById(db, inserted.id)?.id).toBe(inserted.id)
    })
  })

  it('findChatSessionById returns null when absent', async () => {
    await withTestDatabase((db) => {
      expect(findChatSessionById(db, 'session-nope')).toBeNull()
    })
  })

  it('listChatSessionsForWorkspace orders by lastMessageAt desc', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const workspace = makeWorkspace(user.id)
      insertWorkspace(db, workspace)
      const t0 = new Date('2026-05-01T00:00:00Z')
      const t1 = new Date('2026-05-15T00:00:00Z')
      const t2 = new Date('2026-05-20T00:00:00Z')
      insertChatSession(
        db,
        makeChatSession(user.id, workspace.id, { id: 'session-old', lastMessageAt: t0 }),
      )
      insertChatSession(
        db,
        makeChatSession(user.id, workspace.id, { id: 'session-mid', lastMessageAt: t1 }),
      )
      insertChatSession(
        db,
        makeChatSession(user.id, workspace.id, { id: 'session-new', lastMessageAt: t2 }),
      )
      const list = listChatSessionsForWorkspace(db, workspace.id)
      expect(list.map((s) => s.id)).toEqual(['session-new', 'session-mid', 'session-old'])
    })
  })

  it('listChatSessionsForWorkspace excludes archived by default', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const workspace = makeWorkspace(user.id)
      insertWorkspace(db, workspace)
      insertChatSession(db, makeChatSession(user.id, workspace.id, { id: 'active' }))
      insertChatSession(
        db,
        makeChatSession(user.id, workspace.id, { id: 'archived', isArchived: true }),
      )
      expect(listChatSessionsForWorkspace(db, workspace.id).map((s) => s.id)).toEqual(['active'])
      const both = listChatSessionsForWorkspace(db, workspace.id, { includeArchived: true })
      expect(both.map((s) => s.id).sort()).toEqual(['active', 'archived'])
    })
  })

  it('listChatSessionsForWorkspace excludes soft-deleted by default', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const workspace = makeWorkspace(user.id)
      insertWorkspace(db, workspace)
      insertChatSession(db, makeChatSession(user.id, workspace.id, { id: 'live' }))
      insertChatSession(
        db,
        makeChatSession(user.id, workspace.id, { id: 'deleted', deletedAt: new Date() }),
      )
      expect(listChatSessionsForWorkspace(db, workspace.id).map((s) => s.id)).toEqual(['live'])
      const both = listChatSessionsForWorkspace(db, workspace.id, { includeDeleted: true })
      expect(both.map((s) => s.id).sort()).toEqual(['deleted', 'live'])
    })
  })

  it('listChatSessionsForWorkspace excludes hidden by default; rows without visibility backfill to listed (additive guard)', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const workspace = makeWorkspace(user.id)
      insertWorkspace(db, workspace)
      // A session inserted WITHOUT a visibility value (the pre-migration row
      // shape) backfills to 'listed' and STILL lists — the Slice-2
      // additive-invariant regression guard (landmine: existing sessions must
      // never vanish from the sidebar).
      const legacy = insertChatSession(db, makeChatSession(user.id, workspace.id, { id: 'legacy' }))
      expect(legacy.visibility).toBe('listed')
      insertChatSession(
        db,
        makeChatSession(user.id, workspace.id, { id: 'hidden-seg', visibility: 'hidden' }),
      )
      // The curated sidebar shows only the listed session…
      expect(listChatSessionsForWorkspace(db, workspace.id).map((s) => s.id)).toEqual(['legacy'])
      // …includeHidden surfaces the full recorded trail (the future monitor).
      const all = listChatSessionsForWorkspace(db, workspace.id, { includeHidden: true })
      expect(all.map((s) => s.id).sort()).toEqual(['hidden-seg', 'legacy'])
    })
  })

  it('listChatSessionsForWorkspace returns lastMessagePreview from the most recent message', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const workspace = makeWorkspace(user.id)
      insertWorkspace(db, workspace)
      insertChatSession(db, makeChatSession(user.id, workspace.id, { id: 'session-with-messages' }))
      // Two messages — the SECOND (latest startedAt) should win.
      insertChatMessage(db, {
        id: 'msg-old',
        sessionId: 'session-with-messages',
        role: 'user',
        body: 'first message — outdated',
        thinkingBody: null,
        inputTokens: null,
        outputTokens: null,
        attachedImagesMetadata: null,
        errorCode: null,
        errorMessage: null,
        startedAt: new Date('2026-05-28T10:00:00Z'),
        completedAt: new Date('2026-05-28T10:00:01Z'),
        createdAt: new Date('2026-05-28T10:00:00Z'),
      })
      insertChatMessage(db, {
        id: 'msg-new',
        sessionId: 'session-with-messages',
        role: 'assistant',
        body: 'latest assistant reply — should be the preview',
        thinkingBody: null,
        inputTokens: null,
        outputTokens: null,
        attachedImagesMetadata: null,
        errorCode: null,
        errorMessage: null,
        startedAt: new Date('2026-05-28T11:00:00Z'),
        completedAt: new Date('2026-05-28T11:00:05Z'),
        createdAt: new Date('2026-05-28T11:00:00Z'),
      })

      const [row] = listChatSessionsForWorkspace(db, workspace.id)
      expect(row?.id).toBe('session-with-messages')
      expect(row?.lastMessagePreview).toBe('latest assistant reply — should be the preview')
    })
  })

  it('listChatSessionsForWorkspace returns null lastMessagePreview when session has no messages', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const workspace = makeWorkspace(user.id)
      insertWorkspace(db, workspace)
      insertChatSession(db, makeChatSession(user.id, workspace.id, { id: 'empty-session' }))

      const [row] = listChatSessionsForWorkspace(db, workspace.id)
      expect(row?.id).toBe('empty-session')
      expect(row?.lastMessagePreview).toBeNull()
    })
  })

  it('listChatSessionsForWorkspace truncates lastMessagePreview to 120 chars', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const workspace = makeWorkspace(user.id)
      insertWorkspace(db, workspace)
      insertChatSession(db, makeChatSession(user.id, workspace.id, { id: 'long-msg-session' }))
      const long = 'X'.repeat(300)
      insertChatMessage(db, {
        id: 'msg-long',
        sessionId: 'long-msg-session',
        role: 'user',
        body: long,
        thinkingBody: null,
        inputTokens: null,
        outputTokens: null,
        attachedImagesMetadata: null,
        errorCode: null,
        errorMessage: null,
        startedAt: new Date('2026-05-28T10:00:00Z'),
        completedAt: new Date('2026-05-28T10:00:01Z'),
        createdAt: new Date('2026-05-28T10:00:00Z'),
      })

      const [row] = listChatSessionsForWorkspace(db, workspace.id)
      expect(row?.lastMessagePreview?.length).toBe(120)
    })
  })

  it('listChatSessionsForWorkspace clamps limit at MAX_LIST_LIMIT (100)', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const workspace = makeWorkspace(user.id)
      insertWorkspace(db, workspace)
      // Insert 5; passing limit: 999 should still be honored (clamps to 100 max, not below count)
      for (let i = 0; i < 5; i++) {
        insertChatSession(db, makeChatSession(user.id, workspace.id, { id: `session-${i}` }))
      }
      expect(listChatSessionsForWorkspace(db, workspace.id, { limit: 999 })).toHaveLength(5)
    })
  })

  it('insertChatSession returns the inserted row', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const workspace = makeWorkspace(user.id)
      insertWorkspace(db, workspace)
      const inserted = insertChatSession(db, makeChatSession(user.id, workspace.id))
      expect(inserted.userId).toBe(user.id)
      expect(inserted.workspaceId).toBe(workspace.id)
      expect(inserted.providerId).toBe('claude')
    })
  })

  it('updateChatSession patches the row + bumps updatedAt', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const workspace = makeWorkspace(user.id)
      insertWorkspace(db, workspace)
      const inserted = insertChatSession(db, makeChatSession(user.id, workspace.id))
      const updated = updateChatSession(db, inserted.id, { title: 'Renamed' })
      expect(updated?.title).toBe('Renamed')
      expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(inserted.updatedAt.getTime())
    })
  })

  it('updateChatSession returns null on missing id', async () => {
    await withTestDatabase((db) => {
      expect(updateChatSession(db, 'session-nope', { title: 'X' })).toBeNull()
    })
  })

  it('incrementChatSessionCounters adds atomically via SQL-side increment', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const workspace = makeWorkspace(user.id)
      insertWorkspace(db, workspace)
      const session = insertChatSession(db, makeChatSession(user.id, workspace.id))
      incrementChatSessionCounters(db, session.id, {
        messageCountDelta: 2,
        inputTokensDelta: 100,
        outputTokensDelta: 50,
      })
      incrementChatSessionCounters(db, session.id, {
        messageCountDelta: 1,
        inputTokensDelta: 10,
        outputTokensDelta: 5,
      })
      const after = findChatSessionById(db, session.id)
      expect(after!.totalMessageCount).toBe(3)
      expect(after!.totalInputTokens).toBe(110)
      expect(after!.totalOutputTokens).toBe(55)
    })
  })

  it('softDeleteChatSession sets deletedAt; idempotent (second call returns null)', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const workspace = makeWorkspace(user.id)
      insertWorkspace(db, workspace)
      const session = insertChatSession(db, makeChatSession(user.id, workspace.id))
      const first = softDeleteChatSession(db, session.id)
      expect(first?.deletedAt).toBeInstanceOf(Date)
      const second = softDeleteChatSession(db, session.id)
      expect(second).toBeNull()
    })
  })

  it('listChatSessionsDeletedBefore uses exclusive cutoff (deletedAt < cutoff)', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const workspace = makeWorkspace(user.id)
      insertWorkspace(db, workspace)
      const t0 = new Date('2026-04-01T00:00:00Z')
      const t1 = new Date('2026-05-01T00:00:00Z')
      const cutoff = new Date('2026-04-15T00:00:00Z')
      insertChatSession(db, makeChatSession(user.id, workspace.id, { id: 's-old', deletedAt: t0 }))
      insertChatSession(db, makeChatSession(user.id, workspace.id, { id: 's-new', deletedAt: t1 }))
      const expired = listChatSessionsDeletedBefore(db, cutoff)
      expect(expired.map((s) => s.id)).toEqual(['s-old'])
    })
  })

  it('hardDeleteChatSession removes the row and returns true', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const workspace = makeWorkspace(user.id)
      insertWorkspace(db, workspace)
      const session = insertChatSession(db, makeChatSession(user.id, workspace.id))
      expect(hardDeleteChatSession(db, session.id)).toBe(true)
      expect(findChatSessionById(db, session.id)).toBeNull()
      // Second call: no row to delete
      expect(hardDeleteChatSession(db, session.id)).toBe(false)
    })
  })
})
