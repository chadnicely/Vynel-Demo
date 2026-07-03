// Tests for softDeleteChatSession (core op).

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { NotFoundError } from '@vynel/errors'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  insertChatSession,
  findChatSessionById,
  type NewChatSession,
} from '../repositories/index.js'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { CHAT_SESSION_SOFT_DELETED } from '../chat-events.js'
import { softDeleteChatSession } from './soft-delete-chat-session.js'

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

function makeSession(userId: string, workspaceId: string): NewChatSession {
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
  }
}

describe('softDeleteChatSession (core)', () => {
  it('sets deletedAt and emits CHAT_SESSION_SOFT_DELETED in the same transaction', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const session = insertChatSession(db, makeSession(user.id, ws.id))

      softDeleteChatSession(db, session.id)

      const after = findChatSessionById(db, session.id)
      expect(after?.deletedAt).toBeInstanceOf(Date)
      const events = listOutboxEventsByType(db, CHAT_SESSION_SOFT_DELETED)
      expect(events).toHaveLength(1)
      expect(events[0]!.payload).toMatchObject({
        userId: user.id,
        workspaceId: ws.id,
        sessionId: session.id,
      })
    })
  })

  it('throws NotFoundError when session id is missing (no event)', async () => {
    await withTestDatabase((db) => {
      expect(() => softDeleteChatSession(db, 'session-nope')).toThrow(NotFoundError)
      expect(listOutboxEventsByType(db, CHAT_SESSION_SOFT_DELETED)).toHaveLength(0)
    })
  })

  it('is idempotent: second call on an already-deleted session is a silent no-op (no duplicate event)', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const session = insertChatSession(db, makeSession(user.id, ws.id))
      softDeleteChatSession(db, session.id)
      softDeleteChatSession(db, session.id) // no throw
      expect(listOutboxEventsByType(db, CHAT_SESSION_SOFT_DELETED)).toHaveLength(1)
    })
  })
})
