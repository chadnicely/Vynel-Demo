// Repository tests for the FTS5 search repo.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '../../test-support/with-test-database.js'
import { insertUser } from '../users/users.js'
import { insertWorkspace } from '../workspaces/workspaces.js'
import { insertChatSession, type NewChatSession, softDeleteChatSession } from './chat-sessions.js'
import { insertChatMessage, type NewChatMessage } from './chat-messages.js'
import { searchChatMessages } from './chat-search.js'

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

function makeChatSession(userId: string, workspaceId: string): NewChatSession {
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

describe('searchChatMessages (FTS5 external-content)', () => {
  it('returns matches scoped to the given workspaceId', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const wsA = makeWorkspace(user.id)
      const wsB = makeWorkspace(user.id)
      insertWorkspace(db, wsA)
      insertWorkspace(db, wsB)
      const sA = insertChatSession(db, makeChatSession(user.id, wsA.id))
      const sB = insertChatSession(db, makeChatSession(user.id, wsB.id))
      insertChatMessage(db, makeMessage(sA.id, 'muffin recipe for the bakery'))
      insertChatMessage(db, makeMessage(sB.id, 'muffin was the cat name'))
      const hits = searchChatMessages(db, { workspaceId: wsA.id, query: 'muffin' })
      expect(hits.map((h) => h.sessionId)).toEqual([sA.id])
    })
  })

  it('returns snippet with <mark>…</mark> highlight markers', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const session = insertChatSession(db, makeChatSession(user.id, ws.id))
      insertChatMessage(db, makeMessage(session.id, 'find the apartment in San Francisco'))
      const [hit] = searchChatMessages(db, { workspaceId: ws.id, query: 'apartment' })
      expect(hit?.snippet).toContain('<mark>apartment</mark>')
    })
  })

  it('excludes matches from soft-deleted sessions', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const live = insertChatSession(db, makeChatSession(user.id, ws.id))
      const deleted = insertChatSession(db, makeChatSession(user.id, ws.id))
      insertChatMessage(db, makeMessage(live.id, 'apple pie'))
      insertChatMessage(db, makeMessage(deleted.id, 'apple cider'))
      softDeleteChatSession(db, deleted.id)
      const hits = searchChatMessages(db, { workspaceId: ws.id, query: 'apple' })
      expect(hits.map((h) => h.sessionId)).toEqual([live.id])
    })
  })

  it('returns empty array on no matches', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const session = insertChatSession(db, makeChatSession(user.id, ws.id))
      insertChatMessage(db, makeMessage(session.id, 'lorem ipsum'))
      expect(searchChatMessages(db, { workspaceId: ws.id, query: 'zebra' })).toEqual([])
    })
  })

  it('respects the limit option', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const session = insertChatSession(db, makeChatSession(user.id, ws.id))
      for (let i = 0; i < 5; i++) {
        insertChatMessage(db, makeMessage(session.id, `quick brown fox number ${i}`))
      }
      const hits = searchChatMessages(db, { workspaceId: ws.id, query: 'brown', limit: 2 })
      expect(hits).toHaveLength(2)
    })
  })
})
