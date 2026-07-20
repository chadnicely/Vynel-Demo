// Repository tests for the `chat_tool_calls` table.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { insertChatSession, type NewChatSession } from './chat-sessions.js'
import { insertChatMessage, type NewChatMessage } from './chat-messages.js'
import {
  appendToChatToolCallSubagentNarrative,
  cancelStartedChatToolCalls,
  findChatToolCallById,
  findChatToolCallByToolUseId,
  listChatToolCallsForMessage,
  listChatToolCallsForSession,
  insertChatToolCall,
  reapAllStartedChatToolCalls,
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

  it('appendToChatToolCallSubagentNarrative handles the null first chunk via COALESCE + concats', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const session = insertChatSession(db, makeChatSession(user.id, ws.id))
      const message = insertChatMessage(db, makeAssistantMessage(session.id))
      const tc = insertChatToolCall(db, makeChatToolCall(message.id, { toolName: 'Agent' }))
      expect(tc.subagentNarrative).toBeNull()
      appendToChatToolCallSubagentNarrative(db, tc.id, 'reading ')
      appendToChatToolCallSubagentNarrative(db, tc.id, 'the file…')
      expect(findChatToolCallById(db, tc.id)?.subagentNarrative).toBe('reading the file…')
    })
  })

  it('updateChatToolCall persists the lean subagent tool list', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const session = insertChatSession(db, makeChatSession(user.id, ws.id))
      const message = insertChatMessage(db, makeAssistantMessage(session.id))
      const tc = insertChatToolCall(db, makeChatToolCall(message.id, { toolName: 'Agent' }))
      const entries = [
        {
          toolUseId: 'tu_sub_1',
          toolName: 'Read',
          toolInput: { file_path: 'a.md' },
          status: 'completed' as const,
          startedAt: '2026-05-01T00:00:01.000Z',
          completedAt: '2026-05-01T00:00:02.000Z',
        },
      ]
      updateChatToolCall(db, tc.id, { subagentToolCalls: entries })
      expect(findChatToolCallById(db, tc.id)?.subagentToolCalls).toEqual(entries)
    })
  })

  it('cancelStartedChatToolCalls settles only the listed STARTED rows', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const session = insertChatSession(db, makeChatSession(user.id, ws.id))
      const message = insertChatMessage(db, makeAssistantMessage(session.id))
      const open = insertChatToolCall(db, makeChatToolCall(message.id))
      const done = insertChatToolCall(
        db,
        makeChatToolCall(message.id, { status: 'completed', completedAt: new Date() }),
      )
      const unlisted = insertChatToolCall(db, makeChatToolCall(message.id))

      const cancelledAt = new Date('2026-07-21T00:00:00Z')
      const cancelled = cancelStartedChatToolCalls(db, [open.id, done.id], cancelledAt)

      // Only the open listed row settles; a terminal row keeps its status
      // (the completion-raced-the-teardown guard) and an unlisted row is
      // another turn's business.
      expect(cancelled.map((row) => row.id)).toEqual([open.id])
      expect(findChatToolCallById(db, open.id)).toMatchObject({
        status: 'cancelled',
        completedAt: cancelledAt,
      })
      expect(findChatToolCallById(db, done.id)?.status).toBe('completed')
      expect(findChatToolCallById(db, unlisted.id)?.status).toBe('started')
    })
  })

  it('cancelStartedChatToolCalls with no ids is a no-op', async () => {
    await withTestDatabase((db) => {
      expect(cancelStartedChatToolCalls(db, [], new Date())).toEqual([])
    })
  })

  it('reapAllStartedChatToolCalls settles EVERY started row, leaves terminal rows', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const session = insertChatSession(db, makeChatSession(user.id, ws.id))
      const message = insertChatMessage(db, makeAssistantMessage(session.id))
      const orphan1 = insertChatToolCall(db, makeChatToolCall(message.id))
      const orphan2 = insertChatToolCall(db, makeChatToolCall(message.id))
      const failed = insertChatToolCall(
        db,
        makeChatToolCall(message.id, {
          status: 'failed',
          isErrorResult: true,
          completedAt: new Date(),
        }),
      )

      const reapedAt = new Date('2026-07-21T00:00:00Z')
      expect(reapAllStartedChatToolCalls(db, reapedAt)).toBe(2)
      expect(findChatToolCallById(db, orphan1.id)).toMatchObject({
        status: 'cancelled',
        completedAt: reapedAt,
      })
      expect(findChatToolCallById(db, orphan2.id)?.status).toBe('cancelled')
      expect(findChatToolCallById(db, failed.id)?.status).toBe('failed')
      // Idempotent: a second boot reaps nothing.
      expect(reapAllStartedChatToolCalls(db, new Date())).toBe(0)
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
