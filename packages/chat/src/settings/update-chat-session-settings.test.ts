// Tests for the per-session composer settings: the update op, the turn
// streams' resolution rule, and the write-through helper — real SQLite via
// @vynel/testing (never mock the DB).

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { NotFoundError } from '@vynel/errors'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  insertChatSession,
  findChatSessionById,
  type NewChatSession,
} from '../repositories/index.js'
import { updateChatSessionSettings } from './update-chat-session-settings.js'
import { resolveTurnSessionSettings } from './resolve-turn-session-settings.js'
import { persistTurnSessionSettings } from './persist-turn-session-settings.js'

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
    title: 'Initial',
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

describe('updateChatSessionSettings (core)', () => {
  it('new columns are born null — "the user never set this"', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const session = insertChatSession(db, makeSession(user.id, ws.id))
      expect(session.sessionMode).toBeNull()
      expect(session.selectedModel).toBeNull()
      expect(session.thinkingEffort).toBeNull()
      expect(session.autoBuildout).toBeNull()
    })
  })

  it('writes only the provided fields — a partial patch leaves the rest untouched', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const session = insertChatSession(db, makeSession(user.id, ws.id))

      const first = updateChatSessionSettings(db, session.id, {
        sessionMode: 'bypass',
        selectedModel: 'claude-opus-4-8',
      })
      expect(first.sessionMode).toBe('bypass')
      expect(first.selectedModel).toBe('claude-opus-4-8')
      expect(first.thinkingEffort).toBeNull()

      const second = updateChatSessionSettings(db, session.id, { thinkingEffort: 'max' })
      expect(second.sessionMode).toBe('bypass')
      expect(second.selectedModel).toBe('claude-opus-4-8')
      expect(second.thinkingEffort).toBe('max')
    })
  })

  it('persists autoBuildout both ways (true and back to false — never null again)', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const session = insertChatSession(db, makeSession(user.id, ws.id))
      expect(updateChatSessionSettings(db, session.id, { autoBuildout: true }).autoBuildout).toBe(
        true,
      )
      expect(updateChatSessionSettings(db, session.id, { autoBuildout: false }).autoBuildout).toBe(
        false,
      )
    })
  })

  it('an empty patch is a no-op read of the existing row', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const session = insertChatSession(db, makeSession(user.id, ws.id))
      const result = updateChatSessionSettings(db, session.id, {})
      expect(result.id).toBe(session.id)
    })
  })

  it('throws NotFoundError for an unknown session', async () => {
    await withTestDatabase((db) => {
      expect(() => updateChatSessionSettings(db, 'session-nope', { sessionMode: 'auto' })).toThrow(
        NotFoundError,
      )
      expect(() => updateChatSessionSettings(db, 'session-nope', {})).toThrow(NotFoundError)
    })
  })
})

describe('resolveTurnSessionSettings', () => {
  it('explicit input wins over the persisted row', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const session = insertChatSession(db, makeSession(user.id, ws.id))
      updateChatSessionSettings(db, session.id, {
        sessionMode: 'auto',
        selectedModel: 'claude-sonnet-5',
        thinkingEffort: 'low',
      })
      const row = findChatSessionById(db, session.id)
      const resolved = resolveTurnSessionSettings(
        { mode: 'bypass', model: 'claude-opus-4-8', thinkingEffort: 'max' },
        row,
      )
      expect(resolved).toEqual({
        mode: 'bypass',
        model: 'claude-opus-4-8',
        thinkingEffort: 'max',
      })
    })
  })

  it('falls back to the persisted row when the input omits a field', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const session = insertChatSession(db, makeSession(user.id, ws.id))
      updateChatSessionSettings(db, session.id, {
        sessionMode: 'auto',
        selectedModel: 'claude-sonnet-5',
      })
      const row = findChatSessionById(db, session.id)
      const resolved = resolveTurnSessionSettings({}, row)
      expect(resolved.mode).toBe('auto')
      expect(resolved.model).toBe('claude-sonnet-5')
      // Never set on the row either — stays undefined so the caller's own
      // surface default applies (the global core keeps its bypass default).
      expect(resolved.thinkingEffort).toBeUndefined()
    })
  })

  it('a null row (fresh conversation) resolves to the input alone', () => {
    const resolved = resolveTurnSessionSettings({ mode: 'ask' }, null)
    expect(resolved).toEqual({ mode: 'ask', model: undefined, thinkingEffort: undefined })
  })
})

describe('persistTurnSessionSettings', () => {
  it('stamps exactly what the request carried', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const session = insertChatSession(db, makeSession(user.id, ws.id))
      persistTurnSessionSettings(db, session.id, {
        mode: 'auto',
        model: 'claude-opus-4-8',
        thinkingEffort: 'high',
        autoBuildout: true,
      })
      const row = findChatSessionById(db, session.id)
      expect(row?.sessionMode).toBe('auto')
      expect(row?.selectedModel).toBe('claude-opus-4-8')
      expect(row?.thinkingEffort).toBe('high')
      expect(row?.autoBuildout).toBe(true)
    })
  })

  it('an empty request writes nothing (channel/voice turns stay "never set")', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const session = insertChatSession(db, makeSession(user.id, ws.id))
      const before = findChatSessionById(db, session.id)
      persistTurnSessionSettings(db, session.id, {})
      const after = findChatSessionById(db, session.id)
      expect(after?.sessionMode).toBeNull()
      expect(after?.updatedAt.getTime()).toBe(before?.updatedAt.getTime())
    })
  })

  it('never throws — an unknown session is logged, not fatal (the turn continues)', async () => {
    await withTestDatabase((db) => {
      expect(() =>
        persistTurnSessionSettings(db, 'session-nope', { mode: 'ask' }),
      ).not.toThrow()
    })
  })
})
