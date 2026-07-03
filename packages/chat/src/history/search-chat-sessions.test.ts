// Tests for searchChatSessions (core op). Defense-in-depth on the
// min-query-length guard; FTS5 plumbing is covered by chat-search.test.ts.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  insertChatSession,
  insertChatMessage,
  type NewChatSession,
  type NewChatMessage,
} from '../repositories/index.js'
import { searchChatSessions } from './search-chat-sessions.js'

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

function makeMessage(sessionId: string, body: string): NewChatMessage {
  const now = new Date()
  return {
    id: randomUUID(),
    sessionId,
    role: 'user',
    body,
    thinkingBody: null,
    inputTokens: null,
    outputTokens: null,
    attachedImagesMetadata: null,
    errorCode: null,
    errorMessage: null,
    startedAt: now,
    completedAt: now,
    createdAt: now,
  }
}

describe('searchChatSessions (core)', () => {
  it('returns empty array for query shorter than MIN_QUERY_LENGTH (2)', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const session = insertChatSession(db, makeSession(user.id, ws.id))
      insertChatMessage(db, makeMessage(session.id, 'apple pie'))
      expect(searchChatSessions(db, { workspaceId: ws.id, query: 'a' })).toEqual([])
    })
  })

  it('trims the query before length check', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const session = insertChatSession(db, makeSession(user.id, ws.id))
      insertChatMessage(db, makeMessage(session.id, 'apple'))
      // 1 letter + whitespace trimmed = 1 → too short
      expect(searchChatSessions(db, { workspaceId: ws.id, query: '  a  ' })).toEqual([])
    })
  })

  it('delegates to FTS5 for valid queries', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const session = insertChatSession(db, makeSession(user.id, ws.id))
      insertChatMessage(db, makeMessage(session.id, 'apple cinnamon recipe'))
      const hits = searchChatSessions(db, { workspaceId: ws.id, query: 'apple' })
      expect(hits).toHaveLength(1)
      expect(hits[0]!.sessionId).toBe(session.id)
    })
  })
})
