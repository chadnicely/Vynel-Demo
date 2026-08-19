// `resolveInteractiveTurnSettings` — the one home the three interactive streams
// resolve their turn settings through: keyboard `input ?? row ?? DEFAULT` for
// all four settings; voice = the tier forced over the body, no row read, the
// pin fit-clamped against the resumed occupancy.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { buildNewChatSessionRow } from '@vynel/chat'
import { insertChatSession, updateChatSession } from '@vynel/chat/repositories'
import { DEFAULT_SESSION_MODE, toPermissionMode } from '@vynel/session'
import { VOICE_TIER_MODE, VOICE_TIER_MODEL } from '@vynel/contracts/chat/voice-tier'
import type { Database } from '@vynel/db'
import { resolveInteractiveTurnSettings } from './interactive-turn-settings.js'

const silentLogger = pino({ level: 'silent' })

function seedSession(db: Database, sessionId: string): void {
  const now = new Date()
  const user = insertUser(db, {
    id: randomUUID(),
    displayName: 'T',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  })
  insertChatSession(
    db,
    buildNewChatSessionRow({
      sessionId,
      userId: user.id,
      workspaceId: null,
      providerId: 'claude',
      startedAt: now,
      title: 'Global brain',
      visibility: 'hidden',
    }),
  )
}

describe('resolveInteractiveTurnSettings — keyboard', () => {
  it('a fresh conversation resolves the defaults: DEFAULT_SESSION_MODE, no model, no effort, no autopilot', async () => {
    await withTestDatabase(async (db) => {
      expect(
        resolveInteractiveTurnSettings(db, {}, { sessionId: null }, { logger: silentLogger }),
      ).toEqual({
        permissionMode: toPermissionMode(DEFAULT_SESSION_MODE),
        model: undefined,
        thinkingEffort: undefined,
        autoBuildout: undefined,
      })
    })
  })

  it("input beats the row, the row beats the default — for all four settings, autoBuildout included", async () => {
    await withTestDatabase(async (db) => {
      seedSession(db, 'sdk-settings')
      updateChatSession(db, 'sdk-settings', {
        sessionMode: 'ask',
        selectedModel: 'claude-opus-4-8',
        thinkingEffort: 'high',
        autoBuildout: true,
      })
      // Row only.
      expect(
        resolveInteractiveTurnSettings(db, {}, { sessionId: 'sdk-settings' }, { logger: silentLogger }),
      ).toEqual({
        permissionMode: 'ask',
        model: 'claude-opus-4-8',
        thinkingEffort: 'high',
        autoBuildout: true,
      })
      // Input wins where given; the rest still comes from the row.
      expect(
        resolveInteractiveTurnSettings(
          db,
          { mode: 'bypass', autoBuildout: false },
          { sessionId: 'sdk-settings' },
          { logger: silentLogger },
        ),
      ).toEqual({
        permissionMode: 'bypass',
        model: 'claude-opus-4-8',
        thinkingEffort: 'high',
        autoBuildout: false,
      })
    })
  })
})

describe('resolveInteractiveTurnSettings — voice', () => {
  it('forces the tier over the body and never reads the row', async () => {
    await withTestDatabase(async (db) => {
      seedSession(db, 'sdk-voice')
      updateChatSession(db, 'sdk-voice', {
        sessionMode: 'ask',
        selectedModel: 'claude-opus-4-8',
        thinkingEffort: 'high',
        autoBuildout: true,
      })
      expect(
        resolveInteractiveTurnSettings(
          db,
          { voice: true, mode: 'ask', model: 'claude-haiku-4-5', thinkingEffort: 'max', autoBuildout: true },
          { sessionId: 'sdk-voice' },
          { logger: silentLogger },
        ),
      ).toEqual({
        permissionMode: toPermissionMode(VOICE_TIER_MODE),
        model: VOICE_TIER_MODEL,
        thinkingEffort: 'low',
        autoBuildout: undefined,
      })
    })
  })

  it("sets the pin aside for a session the tier's window cannot hold (the fit guard's verdict runs the turn)", async () => {
    await withTestDatabase(async (db) => {
      seedSession(db, 'sdk-fat')
      // Past the swap threshold on the tier's own 1M window (the 2026-08-19
      // incident shape, one generation up): no larger window exists, so the
      // guard hands the turn to the engine default rather than a pin that
      // provably dies with "Prompt is too long".
      updateChatSession(db, 'sdk-fat', { model: 'claude-fable-5[1m]', lastContextTokens: 900_000 })
      const resolved = resolveInteractiveTurnSettings(
        db,
        { voice: true },
        { sessionId: 'sdk-fat' },
        { logger: silentLogger },
      )
      expect(resolved.model).not.toBe(VOICE_TIER_MODEL)
      expect(resolved.model).toBeUndefined()
      expect(resolved.permissionMode).toBe(toPermissionMode(VOICE_TIER_MODE))
      // A session the pin CAN hold keeps the tier.
      updateChatSession(db, 'sdk-fat', { lastContextTokens: 400_000 })
      expect(
        resolveInteractiveTurnSettings(db, { voice: true }, { sessionId: 'sdk-fat' }, { logger: silentLogger })
          .model,
      ).toBe(VOICE_TIER_MODEL)
    })
  })
})
