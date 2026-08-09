// Tests for getChatSessionDetail (core op).

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { NotFoundError } from '@vynel/errors'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  insertChatSession,
  insertChatMessage,
  insertChatToolCall,
  softDeleteChatSession,
  type NewChatSession,
  type NewChatMessage,
  type NewChatToolCall,
} from '../repositories/index.js'
import { getChatSessionDetail } from './get-chat-session-detail.js'

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

function makeMessage(sessionId: string, id: string): NewChatMessage {
  const now = new Date()
  return {
    id,
    sessionId,
    role: 'assistant',
    body: '',
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

function makeToolCall(parentMessageId: string, name: string): NewChatToolCall {
  const now = new Date()
  return {
    id: randomUUID(),
    parentMessageId,
    toolUseId: `toolu_${randomUUID()}`,
    toolName: name,
    toolInput: {},
    toolOutput: null,
    status: 'started',
    approvalStatus: null,
    isErrorResult: false,
    startedAt: now,
    completedAt: null,
  }
}

describe('getChatSessionDetail (core)', () => {
  it('returns session + messages + toolCallsByMessageId record', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const session = insertChatSession(db, makeChatSession(user.id, ws.id))
      const m1 = insertChatMessage(db, makeMessage(session.id, 'msg-1'))
      const m2 = insertChatMessage(db, makeMessage(session.id, 'msg-2'))
      insertChatToolCall(db, makeToolCall(m1.id, 'Read'))
      insertChatToolCall(db, makeToolCall(m1.id, 'Bash'))
      insertChatToolCall(db, makeToolCall(m2.id, 'Write'))

      const detail = getChatSessionDetail(db, session.id)
      expect(detail.session.id).toBe(session.id)
      expect(detail.messages.map((m) => m.id).sort()).toEqual(['msg-1', 'msg-2'])
      expect(detail.toolCallsByMessageId['msg-1']?.length).toBe(2)
      expect(detail.toolCallsByMessageId['msg-2']?.length).toBe(1)
    })
  })

  it('throws NotFoundError on missing sessionId', async () => {
    await withTestDatabase((db) => {
      expect(() => getChatSessionDetail(db, 'session-nope')).toThrow(NotFoundError)
    })
  })

  it('throws NotFoundError on soft-deleted session (no enumeration leak)', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const session = insertChatSession(db, makeChatSession(user.id, ws.id))
      softDeleteChatSession(db, session.id)
      expect(() => getChatSessionDetail(db, session.id)).toThrow(NotFoundError)
    })
  })

  it('throws NotFoundError on a forbidden scope (the cross-session tool wall)', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const globalThread = insertChatSession(db, {
        ...makeChatSession(user.id, ''),
        workspaceId: null,
        scope: 'global',
      })
      expect(() =>
        getChatSessionDetail(db, globalThread.id, {
          ownerUserId: user.id,
          forbiddenScopes: ['global'],
        }),
      ).toThrow(NotFoundError)
      // Without the option the same session reads fine (the UI's root door).
      expect(getChatSessionDetail(db, globalThread.id).session.id).toBe(globalThread.id)
    })
  })

  it('returns empty toolCallsByMessageId for messages without tool calls', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const session = insertChatSession(db, makeChatSession(user.id, ws.id))
      insertChatMessage(db, makeMessage(session.id, 'msg-1'))
      const detail = getChatSessionDetail(db, session.id)
      expect(detail.toolCallsByMessageId).toEqual({})
    })
  })
})
