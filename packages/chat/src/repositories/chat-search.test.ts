// Repository tests for the FTS5 search repo.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
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
      const hits = searchChatMessages(db, { userId: user.id, workspaceId: wsA.id, query: 'muffin' })
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
      const [hit] = searchChatMessages(db, { userId: user.id, workspaceId: ws.id, query: 'apartment' })
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
      const hits = searchChatMessages(db, { userId: user.id, workspaceId: ws.id, query: 'apple' })
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
      expect(searchChatMessages(db, { userId: user.id, workspaceId: ws.id, query: 'zebra' })).toEqual([])
    })
  })

  it('searches across ALL of the user’s workspaces when workspaceId is omitted', async () => {
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
      const hits = searchChatMessages(db, { userId: user.id, query: 'muffin' })
      expect(hits.map((h) => h.sessionId).sort()).toEqual([sA.id, sB.id].sort())
    })
  })

  it('includes workspace-less spawned sessions in a system-wide search', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const spawned = insertChatSession(db, {
        ...makeChatSession(user.id, ''),
        workspaceId: null,
        scope: 'spawned',
      })
      insertChatMessage(db, makeMessage(spawned.id, 'muffin research notes'))
      const hits = searchChatMessages(db, { userId: user.id, query: 'muffin' })
      expect(hits.map((h) => h.sessionId)).toEqual([spawned.id])
    })
  })

  it("never surfaces the global root's own thread (scope 'global')", async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const globalThread = insertChatSession(db, {
        ...makeChatSession(user.id, ''),
        workspaceId: null,
        scope: 'global',
      })
      insertChatMessage(db, makeMessage(globalThread.id, 'muffin secret plans'))
      expect(searchChatMessages(db, { userId: user.id, query: 'muffin' })).toEqual([])
    })
  })

  it("excludes other users' sessions", async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      const other = makeUser()
      insertUser(db, user)
      insertUser(db, other)
      const otherWs = makeWorkspace(other.id)
      insertWorkspace(db, otherWs)
      const otherSession = insertChatSession(db, makeChatSession(other.id, otherWs.id))
      insertChatMessage(db, makeMessage(otherSession.id, 'muffin gossip'))
      expect(searchChatMessages(db, { userId: user.id, query: 'muffin' })).toEqual([])
    })
  })

  it('returns [] for malformed FTS5 query input instead of throwing', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const session = insertChatSession(db, makeChatSession(user.id, ws.id))
      insertChatMessage(db, makeMessage(session.id, 'error: connection refused'))
      // Unbalanced quote, bare NEAR operator, and a colon term (FTS5 reads
      // `error` as a column filter) — all query-parser failures, all no-match.
      for (const query of ['"unbalanced', 'NEAR(', 'error: connection']) {
        expect(searchChatMessages(db, { userId: user.id, query })).toEqual([])
      }
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
      const hits = searchChatMessages(db, { userId: user.id, workspaceId: ws.id, query: 'brown', limit: 2 })
      expect(hits).toHaveLength(2)
    })
  })
})
