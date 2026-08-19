// Pins THE resolution rule — `input ?? row ?? DEFAULT` — on real rows (real
// SQLite via @vynel/testing; never mock the DB), because the round trip is the
// point: what `updateChatSessionSettings` writes is what a later turn reads.
//
// `autoBuildout` joined the resolved set in the session-hardening arc (D8): it
// was persisted, copied forward and served for weeks while no runner read it.
// Now the workspace/DM runner and the global core both do, so it resolves like
// every other setting — including the birth-stamped case (D4), where a child's
// inherited value sits on its own row and a tool argument still overrides it.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import {
  insertChatSession,
  findChatSessionById,
  type NewChatSession,
} from '../repositories/index.js'
import { updateChatSessionSettings } from './update-chat-session-settings.js'
import { resolveTurnSessionSettings } from './resolve-turn-session-settings.js'

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
        autoBuildout: false,
      })
      const row = findChatSessionById(db, session.id)
      const resolved = resolveTurnSessionSettings(
        {
          mode: 'bypass',
          model: 'claude-opus-4-8',
          thinkingEffort: 'max',
          autoBuildout: true,
        },
        row,
      )
      expect(resolved).toEqual({
        mode: 'bypass',
        model: 'claude-opus-4-8',
        thinkingEffort: 'max',
        autoBuildout: true,
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
        autoBuildout: true,
      })
      const row = findChatSessionById(db, session.id)
      const resolved = resolveTurnSessionSettings({}, row)
      expect(resolved.mode).toBe('auto')
      expect(resolved.model).toBe('claude-sonnet-5')
      expect(resolved.autoBuildout).toBe(true)
      // Never set on the row either — stays undefined so the caller's own
      // `?? DEFAULT_SESSION_MODE` applies (the third rung of the ladder).
      expect(resolved.thinkingEffort).toBeUndefined()
    })
  })

  it('a null row (fresh conversation) resolves to the input alone', () => {
    const resolved = resolveTurnSessionSettings({ mode: 'ask' }, null)
    expect(resolved).toEqual({
      mode: 'ask',
      model: undefined,
      thinkingEffort: undefined,
      autoBuildout: undefined,
    })
  })

  it('never-set autoBuildout stays undefined — the runner appends no autopilot marker', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const session = insertChatSession(db, makeSession(user.id, ws.id))
      const resolved = resolveTurnSessionSettings({}, findChatSessionById(db, session.id))
      expect(resolved.autoBuildout).toBeUndefined()
    })
  })

  it('an explicit false beats a row that says true (the tool-arg override, D4)', async () => {
    await withTestDatabase((db) => {
      const user = makeUser()
      insertUser(db, user)
      const ws = makeWorkspace(user.id)
      insertWorkspace(db, ws)
      const session = insertChatSession(db, makeSession(user.id, ws.id))
      // A birth-stamped child: its row carries the creator's autopilot + mode.
      updateChatSessionSettings(db, session.id, { autoBuildout: true, sessionMode: 'bypass' })
      const row = findChatSessionById(db, session.id)
      const resolved = resolveTurnSessionSettings({ autoBuildout: false, mode: 'ask' }, row)
      expect(resolved.autoBuildout).toBe(false)
      expect(resolved.mode).toBe('ask')
    })
  })
})
