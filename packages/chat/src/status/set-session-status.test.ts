// `setSessionStatus` — the per-conversation status light: writes the trio,
// co-commits the outbox event, owner-gates like the workspace sibling.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { NotFoundError } from '@vynel/errors'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { listOutboxEventsByType } from '@vynel/db/repositories/_shared'
import { insertChatSession, type NewChatSession } from '../repositories/index.js'
import { CHAT_SESSION_STATUS_SET, type ChatSessionStatusSetPayload } from '../chat-events.js'
import { setSessionStatus } from './set-session-status.js'

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

describe('setSessionStatus (core)', () => {
  it('writes the trio and co-commits chat.session-status-set', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const session = insertChatSession(db, makeSession(user.id, ws.id))

      const updated = setSessionStatus(db, {
        userId: user.id,
        sessionId: session.id,
        status: 'needs_input',
        note: 'Pick a variant before I build further.',
      })
      expect(updated.status).toBe('needs_input')
      expect(updated.statusNote).toBe('Pick a variant before I build further.')
      expect(updated.statusSetAt).not.toBeNull()

      const events = listOutboxEventsByType(db, CHAT_SESSION_STATUS_SET)
      expect(events).toHaveLength(1)
      const payload = events[0]!.payload as ChatSessionStatusSetPayload
      expect(payload).toMatchObject({
        userId: user.id,
        workspaceId: ws.id,
        sessionId: session.id,
        status: 'needs_input',
        note: 'Pick a variant before I build further.',
      })
    })
  })

  it('a later write replaces the trio (a fact, not an accumulation)', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const session = insertChatSession(db, makeSession(user.id, ws.id))
      setSessionStatus(db, { userId: user.id, sessionId: session.id, status: 'problem', note: 'x' })
      const second = setSessionStatus(db, {
        userId: user.id,
        sessionId: session.id,
        status: 'completed',
      })
      expect(second.status).toBe('completed')
      expect(second.statusNote).toBeNull()
    })
  })

  it("404s unknown ids and other users' sessions alike", async () => {
    await withTestDatabase((db) => {
      const owner = makeUser()
      insertUser(db, owner)
      const stranger = makeUser()
      insertUser(db, stranger)
      const ws = makeWorkspace(owner.id)
      insertWorkspace(db, ws)
      const session = insertChatSession(db, makeSession(owner.id, ws.id))

      expect(() =>
        setSessionStatus(db, { userId: stranger.id, sessionId: session.id, status: 'problem' }),
      ).toThrow(NotFoundError)
      expect(() =>
        setSessionStatus(db, { userId: owner.id, sessionId: 'session-nope', status: 'problem' }),
      ).toThrow(NotFoundError)
    })
  })
})
