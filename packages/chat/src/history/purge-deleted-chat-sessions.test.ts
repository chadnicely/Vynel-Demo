// Tests for purgeDeletedChatSessions (core op).
//
// Real SQLite via withTestDatabase (no DB mocking per foundation §11 #6).
// Asserts the (purged | retained | active) trichotomy + outbox emission +
// cascade + custom-retention override.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  insertChatSession,
  findChatSessionById,
  insertChatMessage,
  listChatMessagesForSession,
  type NewChatSession,
  type NewChatMessage,
} from '../repositories/index.js'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { CHAT_SESSION_HARD_DELETED } from '../chat-events.js'
import { purgeDeletedChatSessions } from './purge-deleted-chat-sessions.js'

const MILLIS_PER_DAY = 24 * 60 * 60 * 1000

function makeUser() {
  return {
    id: randomUUID(),
    displayName: 'T',
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
    name: 'WS',
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
  workspaceId: string,
  overrides: Partial<NewChatSession> = {},
): NewChatSession {
  const now = new Date()
  return {
    id: `session-${randomUUID()}`,
    userId,
    workspaceId,
    providerId: 'claude',
    title: 'T',
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

function makeMessage(sessionId: string, overrides: Partial<NewChatMessage> = {}): NewChatMessage {
  const now = new Date()
  return {
    id: randomUUID(),
    sessionId,
    role: 'user',
    body: 'hi',
    thinkingBody: null,
    inputTokens: null,
    outputTokens: null,
    attachedImagesMetadata: null,
    errorCode: null,
    errorMessage: null,
    startedAt: now,
    completedAt: now,
    createdAt: now,
    ...overrides,
  }
}

describe('purgeDeletedChatSessions (core)', () => {
  it('hard-deletes sessions whose deletedAt is older than the retention window, leaves others alone', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)

      // 31 days old → should be purged.
      const expired = insertChatSession(
        db,
        makeSession(user.id, ws.id, {
          id: 'session-expired',
          deletedAt: new Date(Date.now() - 31 * MILLIS_PER_DAY),
        }),
      )
      // 29 days old → still inside retention; should NOT be purged.
      const retained = insertChatSession(
        db,
        makeSession(user.id, ws.id, {
          id: 'session-retained',
          deletedAt: new Date(Date.now() - 29 * MILLIS_PER_DAY),
        }),
      )
      // Active (never soft-deleted) → should NOT be purged.
      const active = insertChatSession(db, makeSession(user.id, ws.id, { id: 'session-active' }))

      const result = purgeDeletedChatSessions(db)

      expect(result.purgedCount).toBe(1)
      expect(result.purgedSessionIds).toEqual([expired.id])
      expect(findChatSessionById(db, expired.id)).toBeNull()
      expect(findChatSessionById(db, retained.id)?.id).toBe(retained.id)
      expect(findChatSessionById(db, active.id)?.id).toBe(active.id)

      const events = listOutboxEventsByType(db, CHAT_SESSION_HARD_DELETED)
      expect(events).toHaveLength(1)
      expect(events[0]!.payload).toMatchObject({
        userId: user.id,
        workspaceId: ws.id,
        sessionId: expired.id,
      })
    })
  })

  it('returns purgedCount=0 and emits no events when nothing is expired', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      insertChatSession(db, makeSession(user.id, ws.id, { id: 'a' }))
      insertChatSession(
        db,
        makeSession(user.id, ws.id, {
          id: 'b',
          deletedAt: new Date(Date.now() - 5 * MILLIS_PER_DAY),
        }),
      )

      const result = purgeDeletedChatSessions(db)

      expect(result.purgedCount).toBe(0)
      expect(result.purgedSessionIds).toEqual([])
      expect(listOutboxEventsByType(db, CHAT_SESSION_HARD_DELETED)).toHaveLength(0)
    })
  })

  it('respects custom retentionDays override (tighter window purges more)', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      // 8-day-old soft-delete: outside the default 30d, but inside a 7d window.
      insertChatSession(
        db,
        makeSession(user.id, ws.id, {
          id: 'session-eight-days',
          deletedAt: new Date(Date.now() - 8 * MILLIS_PER_DAY),
        }),
      )

      const result = purgeDeletedChatSessions(db, { retentionDays: 7 })

      expect(result.purgedCount).toBe(1)
      expect(listOutboxEventsByType(db, CHAT_SESSION_HARD_DELETED)).toHaveLength(1)
    })
  })

  it('purges multiple expired sessions, one outbox event per purge', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const ids = ['s1', 's2', 's3']
      for (const id of ids) {
        insertChatSession(
          db,
          makeSession(user.id, ws.id, {
            id,
            deletedAt: new Date(Date.now() - 60 * MILLIS_PER_DAY),
          }),
        )
      }

      const result = purgeDeletedChatSessions(db)

      expect(result.purgedCount).toBe(3)
      expect(result.purgedSessionIds.sort()).toEqual(ids)
      expect(listOutboxEventsByType(db, CHAT_SESSION_HARD_DELETED)).toHaveLength(3)
    })
  })

  it('cascades to chat_messages via FK ON DELETE CASCADE', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const session = insertChatSession(
        db,
        makeSession(user.id, ws.id, {
          deletedAt: new Date(Date.now() - 60 * MILLIS_PER_DAY),
        }),
      )
      insertChatMessage(db, makeMessage(session.id))
      insertChatMessage(db, makeMessage(session.id, { body: 'two' }))
      expect(listChatMessagesForSession(db, session.id)).toHaveLength(2)

      purgeDeletedChatSessions(db)

      expect(findChatSessionById(db, session.id)).toBeNull()
      expect(listChatMessagesForSession(db, session.id)).toHaveLength(0)
    })
  })

  it('forwards the structural logger when supplied', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      insertChatSession(
        db,
        makeSession(user.id, ws.id, {
          deletedAt: new Date(Date.now() - 60 * MILLIS_PER_DAY),
        }),
      )

      const infoCalls: Array<{ payload: object; message?: string }> = []
      const logger = {
        info: (payload: object, message?: string) => {
          infoCalls.push({ payload, ...(message !== undefined ? { message } : {}) })
        },
        warn: () => {},
        error: () => {},
      }

      purgeDeletedChatSessions(db, {}, { logger })

      expect(infoCalls).toHaveLength(1)
      expect(infoCalls[0]?.message).toBe('purge-deleted-chat-sessions: completed')
      expect(infoCalls[0]?.payload).toMatchObject({ purgedCount: 1, retentionDays: 30 })
    })
  })
})
