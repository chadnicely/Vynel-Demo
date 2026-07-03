// Tests for archiveChatSession + unarchiveChatSession (core ops).

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { NotFoundError } from '@vynel/errors'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { insertChatSession, type NewChatSession } from '../repositories/index.js'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { CHAT_SESSION_ARCHIVED } from '../chat-events.js'
import { archiveChatSession, unarchiveChatSession } from './archive-chat-session.js'

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
  isArchived: boolean = false,
): NewChatSession {
  const now = new Date()
  return {
    id: `session-${randomUUID()}`,
    userId,
    workspaceId,
    providerId: 'claude',
    title: 'T',
    isArchived,
    deletedAt: null,
    totalMessageCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    startedAt: now,
    lastMessageAt: now,
    updatedAt: now,
  }
}

describe('archiveChatSession (core)', () => {
  it('sets isArchived=true and emits CHAT_SESSION_ARCHIVED in the same transaction', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const session = insertChatSession(db, makeSession(user.id, ws.id))
      const updated = archiveChatSession(db, session.id)
      expect(updated.isArchived).toBe(true)

      const events = listOutboxEventsByType(db, CHAT_SESSION_ARCHIVED)
      expect(events).toHaveLength(1)
      expect(events[0]!.payload).toMatchObject({
        userId: user.id,
        workspaceId: ws.id,
        sessionId: session.id,
      })
    })
  })

  it('throws NotFoundError when session id is missing (and does NOT emit event)', async () => {
    await withTestDatabase((db) => {
      expect(() => archiveChatSession(db, 'session-nope')).toThrow(NotFoundError)
      expect(listOutboxEventsByType(db, CHAT_SESSION_ARCHIVED)).toHaveLength(0)
    })
  })
})

describe('unarchiveChatSession (core)', () => {
  it('sets isArchived=false (no event emitted per D20)', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const session = insertChatSession(db, makeSession(user.id, ws.id, /* isArchived */ true))
      const updated = unarchiveChatSession(db, session.id)
      expect(updated.isArchived).toBe(false)
      // No CHAT_SESSION_UNARCHIVED — downstream derives from absence (D20).
      expect(listOutboxEventsByType(db, CHAT_SESSION_ARCHIVED)).toHaveLength(0)
    })
  })

  it('throws NotFoundError when session id is missing', async () => {
    await withTestDatabase((db) => {
      expect(() => unarchiveChatSession(db, 'session-nope')).toThrow(NotFoundError)
    })
  })
})
