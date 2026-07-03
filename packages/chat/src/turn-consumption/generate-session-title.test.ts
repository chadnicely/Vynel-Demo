// Tests for generateSessionTitle — Phase 1 heuristic per D11.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { insertChatSession, insertChatMessage } from '../repositories/index.js'
import type { NewChatSession, NewChatMessage } from '../repositories/index.js'
import { generateSessionTitle } from './generate-session-title.js'

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
    title: 'New session',
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

function makeUserMessage(sessionId: string, body: string): NewChatMessage {
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

describe('generateSessionTitle', () => {
  it('returns the first user message body (trimmed, single line, ≤80 chars)', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const session = insertChatSession(db, makeSession(user.id, ws.id))
      insertChatMessage(db, makeUserMessage(session.id, 'Find me an apartment in San Francisco'))
      expect(generateSessionTitle(db, session.id)).toBe('Find me an apartment in San Francisco')
    })
  })

  it('truncates to MAX_TITLE_LENGTH (80) chars', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const session = insertChatSession(db, makeSession(user.id, ws.id))
      const longBody = 'x'.repeat(200)
      insertChatMessage(db, makeUserMessage(session.id, longBody))
      const title = generateSessionTitle(db, session.id)
      expect(title.length).toBeLessThanOrEqual(80)
    })
  })

  it('uses only the first line', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const session = insertChatSession(db, makeSession(user.id, ws.id))
      insertChatMessage(db, makeUserMessage(session.id, 'First line.\nSecond line.\nThird.'))
      expect(generateSessionTitle(db, session.id)).toBe('First line.')
    })
  })

  it("returns 'New session' when there's no user message yet", async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const session = insertChatSession(db, makeSession(user.id, ws.id))
      expect(generateSessionTitle(db, session.id)).toBe('New session')
    })
  })

  it("returns 'New session' when the first user message is empty/whitespace", async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const session = insertChatSession(db, makeSession(user.id, ws.id))
      insertChatMessage(db, makeUserMessage(session.id, '   \n  '))
      expect(generateSessionTitle(db, session.id)).toBe('New session')
    })
  })
})
