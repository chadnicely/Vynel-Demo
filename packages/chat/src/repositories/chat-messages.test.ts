// Repository tests for the `chat_messages` table.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { insertChatSession, type NewChatSession } from './chat-sessions.js'
import {
  findChatMessageById,
  listChatMessagesForSession,
  listRecentChatMessagesForSession,
  listChatMessagesByPartialSessionId,
  insertChatMessage,
  updateChatMessage,
  appendToChatMessageBody,
  appendToChatMessageThinking,
  type NewChatMessage,
} from './chat-messages.js'

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

function makeChatMessage(
  sessionId: string,
  overrides: Partial<NewChatMessage> = {},
): NewChatMessage {
  const now = new Date()
  return {
    id: randomUUID(),
    sessionId,
    role: 'user',
    body: 'Hello',
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

describe('chatMessages repository', () => {
  it('findChatMessageById returns the row when present', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const workspace = makeWorkspace(user.id)
      insertWorkspace(db, workspace)
      const session = insertChatSession(db, makeChatSession(user.id, workspace.id))
      const inserted = insertChatMessage(db, makeChatMessage(session.id))
      expect(findChatMessageById(db, inserted.id)?.id).toBe(inserted.id)
    })
  })

  it('findChatMessageById returns null when absent', async () => {
    await withTestDatabase((db) => {
      expect(findChatMessageById(db, randomUUID())).toBeNull()
    })
  })

  it('listChatMessagesForSession orders by startedAt asc', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const workspace = makeWorkspace(user.id)
      insertWorkspace(db, workspace)
      const session = insertChatSession(db, makeChatSession(user.id, workspace.id))
      const t1 = new Date('2026-05-01T00:00:00Z')
      const t2 = new Date('2026-05-02T00:00:00Z')
      const t3 = new Date('2026-05-03T00:00:00Z')
      insertChatMessage(db, makeChatMessage(session.id, { body: 'second', startedAt: t2 }))
      insertChatMessage(db, makeChatMessage(session.id, { body: 'first', startedAt: t1 }))
      insertChatMessage(db, makeChatMessage(session.id, { body: 'third', startedAt: t3 }))
      const ordered = listChatMessagesForSession(db, session.id).map((m) => m.body)
      expect(ordered).toEqual(['first', 'second', 'third'])
    })
  })

  it('listChatMessagesByPartialSessionId returns only the tagged chain, in startedAt order', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const workspace = makeWorkspace(user.id)
      insertWorkspace(db, workspace)
      const session = insertChatSession(db, makeChatSession(user.id, workspace.id))
      const t1 = new Date('2026-05-01T00:00:00Z')
      const t2 = new Date('2026-05-02T00:00:00Z')
      const t3 = new Date('2026-05-03T00:00:00Z')
      // Two delegation chains interleaved + one untagged row — the read filters to one key.
      insertChatMessage(db, makeChatMessage(session.id, { body: 'p1-reply', startedAt: t2, partialSessionId: 'p1' }))
      insertChatMessage(db, makeChatMessage(session.id, { body: 'p1-task', startedAt: t1, partialSessionId: 'p1' }))
      insertChatMessage(db, makeChatMessage(session.id, { body: 'p2-task', startedAt: t1, partialSessionId: 'p2' }))
      insertChatMessage(db, makeChatMessage(session.id, { body: 'untagged', startedAt: t3 }))

      expect(listChatMessagesByPartialSessionId(db, 'p1').map((m) => m.body)).toEqual([
        'p1-task',
        'p1-reply',
      ])
    })
  })

  it('listChatMessagesByPartialSessionId returns [] for an unknown key (untagged rows excluded)', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const workspace = makeWorkspace(user.id)
      insertWorkspace(db, workspace)
      const session = insertChatSession(db, makeChatSession(user.id, workspace.id))
      insertChatMessage(db, makeChatMessage(session.id)) // untagged → partialSessionId null
      expect(listChatMessagesByPartialSessionId(db, 'no-such-key')).toEqual([])
    })
  })

  it('listRecentChatMessagesForSession returns the latest N in chronological order', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const workspace = makeWorkspace(user.id)
      insertWorkspace(db, workspace)
      const session = insertChatSession(db, makeChatSession(user.id, workspace.id))
      for (let day = 1; day <= 5; day++) {
        const startedAt = new Date(`2026-05-0${day}T00:00:00Z`)
        insertChatMessage(db, makeChatMessage(session.id, { body: `m${day}`, startedAt }))
      }
      // The 3 most recent, oldest-first within the window.
      const recent = listRecentChatMessagesForSession(db, session.id, 3).map((m) => m.body)
      expect(recent).toEqual(['m3', 'm4', 'm5'])
    })
  })

  it('updateChatMessage patches the row', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const workspace = makeWorkspace(user.id)
      insertWorkspace(db, workspace)
      const session = insertChatSession(db, makeChatSession(user.id, workspace.id))
      const inserted = insertChatMessage(db, makeChatMessage(session.id, { completedAt: null }))
      const completed = new Date()
      const updated = updateChatMessage(db, inserted.id, { completedAt: completed })
      expect(updated?.completedAt?.getTime()).toBe(completed.getTime())
    })
  })

  it('appendToChatMessageBody appends via SQL-side concat (no read-modify-write)', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const workspace = makeWorkspace(user.id)
      insertWorkspace(db, workspace)
      const session = insertChatSession(db, makeChatSession(user.id, workspace.id))
      const msg = insertChatMessage(db, makeChatMessage(session.id, { body: '' }))
      appendToChatMessageBody(db, msg.id, 'Hello')
      appendToChatMessageBody(db, msg.id, ', ')
      appendToChatMessageBody(db, msg.id, 'world')
      expect(findChatMessageById(db, msg.id)?.body).toBe('Hello, world')
    })
  })

  it('appendToChatMessageThinking handles null thinkingBody via COALESCE', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const workspace = makeWorkspace(user.id)
      insertWorkspace(db, workspace)
      const session = insertChatSession(db, makeChatSession(user.id, workspace.id))
      const msg = insertChatMessage(
        db,
        makeChatMessage(session.id, { role: 'assistant', thinkingBody: null }),
      )
      appendToChatMessageThinking(db, msg.id, 'Thinking…')
      appendToChatMessageThinking(db, msg.id, ' more')
      expect(findChatMessageById(db, msg.id)?.thinkingBody).toBe('Thinking… more')
    })
  })
})
