import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import type { Database } from '@vynel/db'
import { insertChatSession, insertChatMessage } from './index.js'
import type { NewChatSession, NewChatMessage } from './index.js'
import { listAssistantUsageRowsSince } from './chat-usage.js'

function seedUser(db: Database) {
  const now = new Date()
  return insertUser(db, {
    id: randomUUID(),
    displayName: 'Dana',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  })
}

function seedWorkspace(db: Database, userId: string) {
  const now = new Date()
  return insertWorkspace(db, {
    id: randomUUID(),
    userId,
    name: 'Acme',
    kind: 'small-business',
    path: `/tmp/vynel/${randomUUID()}`,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
}

function seedSession(
  db: Database,
  userId: string,
  workspaceId: string | null,
  overrides: Partial<NewChatSession> = {},
) {
  const now = new Date()
  return insertChatSession(db, {
    id: `session-${randomUUID()}`,
    userId,
    workspaceId,
    providerId: 'claude',
    model: 'claude-opus-4-8',
    title: 'Session',
    isArchived: false,
    deletedAt: null,
    totalMessageCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    startedAt: now,
    lastMessageAt: now,
    updatedAt: now,
    ...overrides,
  })
}

function seedAssistantMessage(
  db: Database,
  sessionId: string,
  overrides: Partial<NewChatMessage> = {},
) {
  const now = new Date()
  return insertChatMessage(db, {
    id: `message-${randomUUID()}`,
    sessionId,
    role: 'assistant',
    body: 'Done.',
    inputTokens: 100,
    outputTokens: 50,
    startedAt: now,
    createdAt: now,
    ...overrides,
  })
}

describe('listAssistantUsageRowsSince', () => {
  it('returns assistant rows with usage, attributed to the session model + provider', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const session = seedSession(db, user.id, null, { model: 'claude-sonnet-5' })
      seedAssistantMessage(db, session.id, { inputTokens: 111, outputTokens: 22 })

      const rows = listAssistantUsageRowsSince(db, {
        userId: user.id,
        since: new Date(Date.now() - 60_000),
      })
      expect(rows).toEqual([
        expect.objectContaining({
          model: 'claude-sonnet-5',
          providerId: 'claude',
          inputTokens: 111,
          outputTokens: 22,
        }),
      ])
    })
  })

  it('excludes user rows, usage-less assistant rows, rows before the window, and other users', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const otherUser = seedUser(db)
      const session = seedSession(db, user.id, null)
      const otherSession = seedSession(db, otherUser.id, null)

      seedAssistantMessage(db, session.id, { id: 'kept' })
      seedAssistantMessage(db, session.id, {
        role: 'user',
        inputTokens: null,
        outputTokens: null,
      })
      // Streaming row whose usage report never landed — not usage yet.
      seedAssistantMessage(db, session.id, { inputTokens: null, outputTokens: null })
      seedAssistantMessage(db, session.id, {
        createdAt: new Date(Date.now() - 10 * 24 * 3600 * 1000),
      })
      seedAssistantMessage(db, otherSession.id)

      const rows = listAssistantUsageRowsSince(db, {
        userId: user.id,
        since: new Date(Date.now() - 60_000),
      })
      expect(rows).toHaveLength(1)
    })
  })

  it('filters to one workspace when asked, spanning global + all workspaces otherwise', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const workspace = seedWorkspace(db, user.id)
      const otherWorkspace = seedWorkspace(db, user.id)
      seedAssistantMessage(db, seedSession(db, user.id, workspace.id).id, { outputTokens: 1 })
      seedAssistantMessage(db, seedSession(db, user.id, otherWorkspace.id).id, { outputTokens: 2 })
      seedAssistantMessage(db, seedSession(db, user.id, null).id, { outputTokens: 3 })

      const since = new Date(Date.now() - 60_000)
      const scoped = listAssistantUsageRowsSince(db, {
        userId: user.id,
        since,
        workspaceId: workspace.id,
      })
      expect(scoped.map((row) => row.outputTokens)).toEqual([1])

      const all = listAssistantUsageRowsSince(db, { userId: user.id, since })
      expect(all).toHaveLength(3)
    })
  })

  it('keeps usage from soft-deleted sessions — the tokens were spent regardless', async () => {
    await withTestDatabase(async (db) => {
      const user = seedUser(db)
      const session = seedSession(db, user.id, null, { deletedAt: new Date() })
      seedAssistantMessage(db, session.id)

      const rows = listAssistantUsageRowsSince(db, {
        userId: user.id,
        since: new Date(Date.now() - 60_000),
      })
      expect(rows).toHaveLength(1)
    })
  })
})
