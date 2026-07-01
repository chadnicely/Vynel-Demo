// Repository tests for the `chat_tool_calls` table.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '../../test-support/with-test-database.js'
import { insertUser } from '../users/users.js'
import { insertWorkspace } from '../workspaces/workspaces.js'
import { insertChatSession, type NewChatSession } from './chat-sessions.js'
import { insertChatMessage, type NewChatMessage } from './chat-messages.js'
import {
  findChatToolCallById,
  findChatToolCallByToolUseId,
  listChatToolCallsForMessage,
  listChatToolCallsForSession,
  insertChatToolCall,
  updateChatToolCall,
  type NewChatToolCall,
} from './chat-tool-calls.js'

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

function makeAssistantMessage(sessionId: string): NewChatMessage {
  const now = new Date()
  return {
    id: `msg-${randomUUID()}`,
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
    completedAt: null,
    createdAt: now,
  }
}

function makeChatToolCall(
  parentMessageId: string,
  overrides: Partial<NewChatToolCall> = {},
): NewChatToolCall {
  const now = new Date()
  return {
    id: randomUUID(),
    parentMessageId,
    toolUseId: `toolu_${randomUUID()}`,
    toolName: 'Read',
    toolInput: { file: '/tmp/x.md' },
    toolOutput: null,
    status: 'started',
    approvalStatus: null,
    isErrorResult: false,
    startedAt: now,
    completedAt: null,
    ...overrides,
  }
}

describe('chatToolCalls repository', () => {
  it('findChatToolCallById returns the row when present', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const session = insertChatSession(db, makeChatSession(user.id, ws.id))
      const message = insertChatMessage(db, makeAssistantMessage(session.id))
      const tc = insertChatToolCall(db, makeChatToolCall(message.id))
      expect(findChatToolCallById(db, tc.id)?.id).toBe(tc.id)
    })
  })

  it('findChatToolCallByToolUseId returns the row by provider id', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const session = insertChatSession(db, makeChatSession(user.id, ws.id))
      const message = insertChatMessage(db, makeAssistantMessage(session.id))
      const tc = insertChatToolCall(db, makeChatToolCall(message.id, { toolUseId: 'toolu_abc' }))
      const found = findChatToolCallByToolUseId(db, 'toolu_abc')
      expect(found?.id).toBe(tc.id)
    })
  })

  it('listChatToolCallsForMessage orders by startedAt asc', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const session = insertChatSession(db, makeChatSession(user.id, ws.id))
      const message = insertChatMessage(db, makeAssistantMessage(session.id))
      const t1 = new Date('2026-05-01T00:00:00Z')
      const t2 = new Date('2026-05-02T00:00:00Z')
      insertChatToolCall(db, makeChatToolCall(message.id, { toolName: 'second', startedAt: t2 }))
      insertChatToolCall(db, makeChatToolCall(message.id, { toolName: 'first', startedAt: t1 }))
      expect(listChatToolCallsForMessage(db, message.id).map((c) => c.toolName)).toEqual([
        'first',
        'second',
      ])
    })
  })

  it('listChatToolCallsForSession joins through chat_messages by sessionId', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const session = insertChatSession(db, makeChatSession(user.id, ws.id))
      const m1 = insertChatMessage(db, makeAssistantMessage(session.id))
      const m2 = insertChatMessage(db, makeAssistantMessage(session.id))
      insertChatToolCall(db, makeChatToolCall(m1.id, { toolName: 'Read' }))
      insertChatToolCall(db, makeChatToolCall(m2.id, { toolName: 'Bash' }))
      const all = listChatToolCallsForSession(db, session.id)
        .map((c) => c.toolName)
        .sort()
      expect(all).toEqual(['Bash', 'Read'])
    })
  })

  it('updateChatToolCall patches status, isErrorResult, completedAt, toolOutput', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const session = insertChatSession(db, makeChatSession(user.id, ws.id))
      const message = insertChatMessage(db, makeAssistantMessage(session.id))
      const tc = insertChatToolCall(db, makeChatToolCall(message.id))
      const completed = new Date()
      const updated = updateChatToolCall(db, tc.id, {
        status: 'completed',
        isErrorResult: false,
        completedAt: completed,
        toolOutput: { ok: true, lines: 42 },
      })
      expect(updated?.status).toBe('completed')
      expect(updated?.toolOutput).toEqual({ ok: true, lines: 42 })
    })
  })
})
