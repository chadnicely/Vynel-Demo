// Tests for renameChatSession (core op).

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { NotFoundError, ValidationError } from '@vynel/errors'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { insertChatSession, type NewChatSession } from '../repositories/index.js'
import { renameChatSession } from './rename-chat-session.js'

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
    title: 'Initial',
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

describe('renameChatSession (core)', () => {
  it('renames and returns the updated row', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const session = insertChatSession(db, makeSession(user.id, ws.id))
      const updated = renameChatSession(db, session.id, 'New title')
      expect(updated.title).toBe('New title')
    })
  })

  it('trims whitespace before validating and saving', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const session = insertChatSession(db, makeSession(user.id, ws.id))
      const updated = renameChatSession(db, session.id, '   Padded   ')
      expect(updated.title).toBe('Padded')
    })
  })

  it('throws ValidationError when empty (after trim)', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const session = insertChatSession(db, makeSession(user.id, ws.id))
      expect(() => renameChatSession(db, session.id, '   ')).toThrow(ValidationError)
    })
  })

  it('throws ValidationError when over 120 chars', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const session = insertChatSession(db, makeSession(user.id, ws.id))
      expect(() => renameChatSession(db, session.id, 'x'.repeat(121))).toThrow(ValidationError)
    })
  })

  it('throws NotFoundError when session id is missing', async () => {
    await withTestDatabase((db) => {
      expect(() => renameChatSession(db, 'session-nope', 'X')).toThrow(NotFoundError)
    })
  })
})
