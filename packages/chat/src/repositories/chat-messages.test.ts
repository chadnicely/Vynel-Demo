// Repository tests for the `chat_messages` table.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { insertChatSession, type NewChatSession } from './chat-sessions.js'
import {
  findChatMessageById,
  findPriorContextOccupancy,
  findSessionStatusMessageFacts,
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

  it('findPriorContextOccupancy: latest assistant usage STRICTLY before the moment; null when none', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const workspace = makeWorkspace(user.id)
      insertWorkspace(db, workspace)
      const session = insertChatSession(db, makeChatSession(user.id, workspace.id))
      const cutoff = new Date('2026-08-09T10:00:00Z')

      // Before the cutoff: an older usage row (superseded), the LATEST usage
      // row (the baseline), a user row, and a usage-less assistant row —
      // only the latest assistant USAGE counts.
      insertChatMessage(db, makeChatMessage(session.id, {
        role: 'assistant',
        inputTokens: 100,
        startedAt: new Date('2026-08-09T09:00:00Z'),
      }))
      insertChatMessage(db, makeChatMessage(session.id, {
        role: 'assistant',
        inputTokens: 250,
        startedAt: new Date('2026-08-09T09:30:00Z'),
      }))
      insertChatMessage(db, makeChatMessage(session.id, {
        role: 'user',
        startedAt: new Date('2026-08-09T09:45:00Z'),
      }))
      insertChatMessage(db, makeChatMessage(session.id, {
        role: 'assistant',
        inputTokens: null,
        startedAt: new Date('2026-08-09T09:50:00Z'),
      }))
      // AT the cutoff — strictly-before must exclude it (lte would count the
      // run's own first row and zero the delta).
      insertChatMessage(db, makeChatMessage(session.id, {
        role: 'assistant',
        inputTokens: 400,
        startedAt: cutoff,
      }))

      expect(findPriorContextOccupancy(db, session.id, cutoff)).toBe(250)
      // No usage before the earliest row → null (the run opened the session).
      expect(
        findPriorContextOccupancy(db, session.id, new Date('2026-08-09T08:00:00Z')),
      ).toBeNull()
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

describe('findSessionStatusMessageFacts', () => {
  it('an empty session reports no error and no user anchor', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const workspace = makeWorkspace(user.id)
      insertWorkspace(db, workspace)
      const session = insertChatSession(db, makeChatSession(user.id, workspace.id))
      expect(findSessionStatusMessageFacts(db, [session.id])).toEqual({
        lastAssistantError: null,
        latestUserMessageAt: null,
      })
    })
  })

  it('the LATEST assistant message decides the error — a later success self-clears it', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const workspace = makeWorkspace(user.id)
      insertWorkspace(db, workspace)
      const session = insertChatSession(db, makeChatSession(user.id, workspace.id))
      const t1 = new Date('2026-08-16T12:00:00Z')
      const t2 = new Date('2026-08-16T12:56:00Z')
      insertChatMessage(db, makeChatMessage(session.id, { role: 'user', startedAt: t1 }))
      insertChatMessage(
        db,
        makeChatMessage(session.id, {
          role: 'assistant',
          body: '',
          errorCode: 'error_during_execution',
          errorMessage: "You've hit your session limit · resets 2:20pm",
          startedAt: t2,
        }),
      )

      const errored = findSessionStatusMessageFacts(db, [session.id])
      expect(errored.lastAssistantError).toEqual({
        code: 'error_during_execution',
        message: "You've hit your session limit · resets 2:20pm",
        at: t2,
      })
      expect(errored.latestUserMessageAt).toEqual(t1)

      // The retry succeeds — the error is no longer "the last thing that happened".
      const t3 = new Date('2026-08-16T14:30:00Z')
      insertChatMessage(db, makeChatMessage(session.id, { role: 'user', startedAt: t3 }))
      insertChatMessage(
        db,
        makeChatMessage(session.id, {
          role: 'assistant',
          body: 'Joined the call.',
          startedAt: new Date('2026-08-16T14:31:00Z'),
        }),
      )
      const recovered = findSessionStatusMessageFacts(db, [session.id])
      expect(recovered.lastAssistantError).toBeNull()
      expect(recovered.latestUserMessageAt).toEqual(t3)
    })
  })

  // The provider marks a transient failure recoverable and the turn envelope
  // honours it (only `!isRecoverable` marks a turn failed). This read used to
  // key purely off "errorMessage is not null", so a hiccup the provider
  // expected to survive painted the conversation red until the next reply.
  it('a RECOVERABLE failure is not a problem', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const workspace = makeWorkspace(user.id)
      insertWorkspace(db, workspace)
      const session = insertChatSession(db, makeChatSession(user.id, workspace.id))
      insertChatMessage(
        db,
        makeChatMessage(session.id, {
          role: 'assistant',
          body: '',
          errorCode: 'provider_start_timeout',
          errorMessage: 'the engine took too long to start',
          errorIsRecoverable: true,
          startedAt: new Date('2026-08-16T12:56:00Z'),
        }),
      )
      expect(findSessionStatusMessageFacts(db, [session.id]).lastAssistantError).toBeNull()
    })
  })

  it('a recoverable failure does not resurrect an older terminal one', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const workspace = makeWorkspace(user.id)
      insertWorkspace(db, workspace)
      const session = insertChatSession(db, makeChatSession(user.id, workspace.id))
      insertChatMessage(
        db,
        makeChatMessage(session.id, {
          role: 'assistant',
          body: '',
          errorCode: 'error_during_execution',
          errorMessage: "You've hit your session limit",
          errorIsRecoverable: false,
          startedAt: new Date('2026-08-16T12:00:00Z'),
        }),
      )
      insertChatMessage(
        db,
        makeChatMessage(session.id, {
          role: 'assistant',
          body: '',
          errorCode: 'provider_start_timeout',
          errorMessage: 'the engine took too long to start',
          errorIsRecoverable: true,
          startedAt: new Date('2026-08-16T12:56:00Z'),
        }),
      )
      // "The last thing that happened" stays the rule — the recoverable row is
      // skipped, never looked PAST to an older failure.
      expect(findSessionStatusMessageFacts(db, [session.id]).lastAssistantError).toBeNull()
    })
  })

  it('a historical row with no severity recorded still reads as a problem', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const workspace = makeWorkspace(user.id)
      insertWorkspace(db, workspace)
      const session = insertChatSession(db, makeChatSession(user.id, workspace.id))
      insertChatMessage(
        db,
        makeChatMessage(session.id, {
          role: 'assistant',
          body: '',
          errorCode: 'error_during_execution',
          errorMessage: 'boom',
          startedAt: new Date('2026-08-16T12:56:00Z'),
        }),
      )
      expect(
        findSessionStatusMessageFacts(db, [session.id]).lastAssistantError?.message,
      ).toBe('boom')
    })
  })

  it('spans the WHOLE chain — a message-less swap segment inherits its history', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const workspace = makeWorkspace(user.id)
      insertWorkspace(db, workspace)
      const older = insertChatSession(db, makeChatSession(user.id, workspace.id))
      const fresh = insertChatSession(db, makeChatSession(user.id, workspace.id))
      const t1 = new Date('2026-08-16T12:00:00Z')
      insertChatMessage(db, makeChatMessage(older.id, { role: 'user', startedAt: t1 }))
      insertChatMessage(
        db,
        makeChatMessage(older.id, {
          role: 'assistant',
          body: '',
          errorCode: 'error_during_execution',
          errorMessage: 'limit',
          startedAt: new Date('2026-08-16T12:01:00Z'),
        }),
      )

      // The fresh segment alone knows nothing — which is exactly how a swap
      // used to resurrect a superseded status and hide a real error.
      expect(findSessionStatusMessageFacts(db, [fresh.id])).toEqual({
        lastAssistantError: null,
        latestUserMessageAt: null,
      })

      const chain = findSessionStatusMessageFacts(db, [older.id, fresh.id])
      expect(chain.latestUserMessageAt).toEqual(t1)
      expect(chain.lastAssistantError?.message).toBe('limit')
    })
  })

  it('an empty chain asks nothing', async () => {
    await withTestDatabase((db) => {
      expect(findSessionStatusMessageFacts(db, [])).toEqual({
        lastAssistantError: null,
        latestUserMessageAt: null,
      })
    })
  })
})
