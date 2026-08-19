// `resolveBackgroundTurnSettings` — the ONE rule for a turn nobody composes:
// `job ?? target row ?? DEFAULT`, the model fit-checked against the target
// segment, autopilot read off the row (session-hardening A5, D3/D4/D8). Real
// SQLite; the segment row is a real `chat_sessions` row with real settings.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import type { Database } from '@vynel/db'
import { insertChatSession, updateChatSession, type ChatSession } from '@vynel/chat/repositories'
import { buildNewChatSessionRow } from '@vynel/chat'
import { resolveBackgroundTurnSettings } from './resolve-background-turn-settings.js'

const NO_PICKS = { permissionMode: null, model: null, thinkingEffort: null } as const

function seedUser(db: Database): string {
  const now = new Date()
  return insertUser(db, {
    id: randomUUID(),
    displayName: 'T',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  }).id
}

function seedSegment(
  db: Database,
  userId: string,
  settings: Partial<
    Pick<
      ChatSession,
      'sessionMode' | 'selectedModel' | 'thinkingEffort' | 'autoBuildout' | 'lastContextTokens' | 'model'
    >
  > = {},
): string {
  const sessionId = `sdk-${randomUUID()}`
  insertChatSession(
    db,
    buildNewChatSessionRow({
      sessionId,
      userId,
      workspaceId: null,
      providerId: 'claude',
      startedAt: new Date(),
    }),
  )
  updateChatSession(db, sessionId, settings)
  return sessionId
}

describe('resolveBackgroundTurnSettings — job ?? target row ?? DEFAULT', () => {
  it.each([
    {
      name: 'nothing anywhere → the one default: auto, engine model, adaptive effort, no autopilot',
      row: {},
      job: NO_PICKS,
      expected: { permissionMode: 'auto', model: undefined, thinkingEffort: undefined, autoBuildout: false },
    },
    {
      name: 'the target row wins over the default (what its user chose for that conversation)',
      row: { sessionMode: 'ask' as const, selectedModel: 'claude-sonnet-4-5', thinkingEffort: 'high' as const },
      job: NO_PICKS,
      expected: { permissionMode: 'ask', model: 'claude-sonnet-4-5', thinkingEffort: 'high', autoBuildout: false },
    },
    {
      name: 'the job wins over the row (a tool arg / the creator’s resolved settings)',
      row: { sessionMode: 'ask' as const, selectedModel: 'claude-sonnet-4-5', thinkingEffort: 'high' as const },
      job: { permissionMode: 'bypass' as const, model: 'claude-haiku-4-5', thinkingEffort: 'low' as const },
      expected: { permissionMode: 'bypass', model: 'claude-haiku-4-5', thinkingEffort: 'low', autoBuildout: false },
    },
    {
      name: 'a row that chose bypass keeps it (explicit picks persist)',
      row: { sessionMode: 'bypass' as const },
      job: NO_PICKS,
      expected: { permissionMode: 'bypass', model: undefined, thinkingEffort: undefined, autoBuildout: false },
    },
  ])('$name', async ({ row, job, expected }) => {
    await withTestDatabase((db) => {
      const userId = seedUser(db)
      const headSdkSessionId = seedSegment(db, userId, row)
      expect(resolveBackgroundTurnSettings(db, { headSdkSessionId, job })).toEqual(expected)
    })
  })

  it('autopilot comes off the target row', async () => {
    await withTestDatabase((db) => {
      const userId = seedUser(db)
      const on = seedSegment(db, userId, { autoBuildout: true })
      const off = seedSegment(db, userId, { autoBuildout: false })
      expect(resolveBackgroundTurnSettings(db, { headSdkSessionId: on, job: NO_PICKS }).autoBuildout).toBe(true)
      expect(resolveBackgroundTurnSettings(db, { headSdkSessionId: off, job: NO_PICKS }).autoBuildout).toBe(false)
    })
  })

  it('a fallback model (a colleague’s own agent.model) sits between the job and the row', async () => {
    await withTestDatabase((db) => {
      const userId = seedUser(db)
      const headSdkSessionId = seedSegment(db, userId, { selectedModel: 'claude-sonnet-4-5' })
      expect(
        resolveBackgroundTurnSettings(db, { headSdkSessionId, job: NO_PICKS, fallbackModel: 'claude-opus-4-1' })
          .model,
      ).toBe('claude-opus-4-1')
      expect(
        resolveBackgroundTurnSettings(db, {
          headSdkSessionId,
          job: { ...NO_PICKS, model: 'claude-haiku-4-5' },
          fallbackModel: 'claude-opus-4-1',
        }).model,
      ).toBe('claude-haiku-4-5')
    })
  })

  it('a first-ever turn (no head) resolves the defaults and skips the fit check', async () => {
    await withTestDatabase((db) => {
      expect(
        resolveBackgroundTurnSettings(db, {
          headSdkSessionId: null,
          job: { ...NO_PICKS, model: 'claude-haiku-4-5' },
        }),
      ).toEqual({ permissionMode: 'auto', model: 'claude-haiku-4-5', thinkingEffort: undefined, autoBuildout: false })
    })
  })

  it('the FIT GUARD: a small-model pick onto a fat target runs on the segment’s own last-ran model instead', async () => {
    await withTestDatabase((db) => {
      const userId = seedUser(db)
      // 400k tokens of history under a 1M-window model — a haiku (200k) pin
      // would die with "Prompt is too long" (the 2026-08-19 voice incident).
      const headSdkSessionId = seedSegment(db, userId, {
        lastContextTokens: 400_000,
        model: 'claude-opus-4-6',
      })
      const resolved = resolveBackgroundTurnSettings(db, {
        headSdkSessionId,
        job: { ...NO_PICKS, model: 'claude-haiku-4-5' },
      })
      expect(resolved.model).toBe('claude-opus-4-6')
      // A pick that fits stands.
      const light = seedSegment(db, userId, { lastContextTokens: 1_000, model: 'claude-opus-4-6' })
      expect(
        resolveBackgroundTurnSettings(db, { headSdkSessionId: light, job: { ...NO_PICKS, model: 'claude-haiku-4-5' } })
          .model,
      ).toBe('claude-haiku-4-5')
    })
  })

  it('a turn that starts a FRESH session on the target (a schedule fire) reads the row’s picks but skips the fit', async () => {
    await withTestDatabase((db) => {
      const userId = seedUser(db)
      // The same fat head — but the new session carries none of its occupancy,
      // so the user's small-model pick for that conversation runs as chosen.
      const headSdkSessionId = seedSegment(db, userId, {
        sessionMode: 'ask',
        selectedModel: 'claude-haiku-4-5',
        lastContextTokens: 400_000,
        model: 'claude-opus-4-6',
        autoBuildout: true,
      })
      expect(
        resolveBackgroundTurnSettings(db, { headSdkSessionId, startsFreshSession: true, job: NO_PICKS }),
      ).toEqual({ permissionMode: 'ask', model: 'claude-haiku-4-5', thinkingEffort: undefined, autoBuildout: true })
    })
  })
})
