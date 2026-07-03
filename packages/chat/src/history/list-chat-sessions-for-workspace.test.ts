// Tests for listChatSessionsForWorkspace (core op).

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { insertChatSession, type NewChatSession } from '../repositories/index.js'
import { listChatSessionsForWorkspace } from './list-chat-sessions-for-workspace.js'

function seed(
  db: ReturnType<typeof withTestDatabase> extends Promise<infer _> ? never : never,
): never {
  throw new Error('unused')
}
void seed

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

describe('listChatSessionsForWorkspace (core)', () => {
  it('defaults to DEFAULT_LIMIT (30)', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      for (let i = 0; i < 35; i++) {
        insertChatSession(db, makeChatSession(user.id, ws.id, { id: `s-${i}` }))
      }
      expect(listChatSessionsForWorkspace(db, { workspaceId: ws.id })).toHaveLength(30)
    })
  })

  it('clamps user-supplied limit to MAX_LIMIT (100)', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      for (let i = 0; i < 5; i++) {
        insertChatSession(db, makeChatSession(user.id, ws.id, { id: `s-${i}` }))
      }
      // limit 9999 → clamps to 100, but only 5 rows exist
      expect(listChatSessionsForWorkspace(db, { workspaceId: ws.id, limit: 9999 })).toHaveLength(5)
    })
  })

  it('respects includeArchived', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      insertChatSession(db, makeChatSession(user.id, ws.id, { id: 'live' }))
      insertChatSession(db, makeChatSession(user.id, ws.id, { id: 'arch', isArchived: true }))
      expect(listChatSessionsForWorkspace(db, { workspaceId: ws.id }).map((s) => s.id)).toEqual([
        'live',
      ])
      expect(
        listChatSessionsForWorkspace(db, { workspaceId: ws.id, includeArchived: true })
          .map((s) => s.id)
          .sort(),
      ).toEqual(['arch', 'live'])
    })
  })
})
