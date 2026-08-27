// `resolveInteractiveTurnSettings` — the one home the three interactive streams
// resolve their turn settings through: keyboard `input ?? row ?? DEFAULT` for
// all four settings; voice = the tier forced over the body, no row read, the
// pin fit-clamped against the resumed occupancy.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser, upsertPreferenceForUser } from '@vynel/db/repositories/users'
import { buildNewChatSessionRow } from '@vynel/chat'
import { insertChatSession, updateChatSession } from '@vynel/chat/repositories'
import { DEFAULT_SESSION_MODE, toPermissionMode } from '@vynel/session'
import {
  VOICE_TIER_MODE,
  VOICE_TIER_MODEL,
  VOICE_TIER_FALLBACK_MODEL,
} from '@vynel/contracts/chat/voice-tier'
import type { Database } from '@vynel/db'
import { resolveInteractiveTurnSettings } from './interactive-turn-settings.js'

const silentLogger = pino({ level: 'silent' })

function seedSession(db: Database, sessionId: string): { userId: string } {
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
  return { userId: user.id }
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
      // test: correct expectation — the tier's thinking is now the
      // `voiceTierThinking` preference, default 'off' (was the fixed 'low'
      // effort): thinking disabled, no effort sent.
      expect(
        resolveInteractiveTurnSettings(
          db,
          { voice: true, mode: 'ask', model: 'claude-opus-4-8', thinkingEffort: 'max', autoBuildout: true },
          { sessionId: 'sdk-voice' },
          { logger: silentLogger },
        ),
      ).toEqual({
        permissionMode: toPermissionMode(VOICE_TIER_MODE),
        model: VOICE_TIER_MODEL,
        thinkingEffort: undefined,
        disableThinking: true,
        autoBuildout: undefined,
      })
    })
  })

  it('the Settings → Voice picks drive the tier: model preference + a thinking level; env still outranks the model pick', async () => {
    await withTestDatabase(async (db) => {
      const { userId } = seedSession(db, 'sdk-pref')
      upsertPreferenceForUser(db, userId, 'voiceTierModel', JSON.stringify(VOICE_TIER_FALLBACK_MODEL))
      upsertPreferenceForUser(db, userId, 'voiceTierThinking', JSON.stringify('low'))

      const resolved = resolveInteractiveTurnSettings(
        db,
        { voice: true },
        { sessionId: 'sdk-pref', userId },
        { logger: silentLogger },
      )
      expect(resolved.model).toBe(VOICE_TIER_FALLBACK_MODEL)
      expect(resolved.thinkingEffort).toBe('low')
      expect(resolved.disableThinking).toBe(false)

      // The env lever (support) outranks the stored model pick; the thinking
      // pick stands beside it.
      const overridden = resolveInteractiveTurnSettings(
        db,
        { voice: true },
        { sessionId: 'sdk-pref', userId, voiceModelOverride: VOICE_TIER_MODEL },
        { logger: silentLogger },
      )
      expect(overridden.model).toBe(VOICE_TIER_MODEL)
      expect(overridden.thinkingEffort).toBe('low')
    })
  })

  // test: correct expectation for the fit clamp — was "the engine default runs
  // an overflowing session", should be the tier's OWN fallback (voice-lean
  // tier, 2026-08-27): {pin, fallback} is the entire voice model universe, so
  // an overflow lands on VOICE_TIER_FALLBACK_MODEL — never the session's model,
  // never the engine default.
  it("clamps a session the pin's window cannot hold to the voice FALLBACK model, never outside the tier", async () => {
    await withTestDatabase(async (db) => {
      seedSession(db, 'sdk-fat')
      // 400k occupancy on a 1M-driven chain: far past the haiku pin's 200k
      // window — the clamp hands the turn to the tier's sonnet fallback.
      updateChatSession(db, 'sdk-fat', { model: 'claude-fable-5[1m]', lastContextTokens: 400_000 })
      const resolved = resolveInteractiveTurnSettings(
        db,
        { voice: true },
        { sessionId: 'sdk-fat' },
        { logger: silentLogger },
      )
      expect(resolved.model).toBe(VOICE_TIER_FALLBACK_MODEL)
      expect(resolved.permissionMode).toBe(toPermissionMode(VOICE_TIER_MODE))
      // A session the pin CAN hold keeps the tier's pin.
      updateChatSession(db, 'sdk-fat', { lastContextTokens: 50_000 })
      expect(
        resolveInteractiveTurnSettings(db, { voice: true }, { sessionId: 'sdk-fat' }, { logger: silentLogger })
          .model,
      ).toBe(VOICE_TIER_MODEL)
    })
  })

  it('the voiceModelOverride replaces the PIN only — the A/B lever (VYNEL_VOICE_TIER_MODEL)', async () => {
    await withTestDatabase(async (db) => {
      seedSession(db, 'sdk-ab')
      updateChatSession(db, 'sdk-ab', { lastContextTokens: 50_000 })
      expect(
        resolveInteractiveTurnSettings(
          db,
          { voice: true },
          { sessionId: 'sdk-ab', voiceModelOverride: VOICE_TIER_FALLBACK_MODEL },
          { logger: silentLogger },
        ).model,
      ).toBe(VOICE_TIER_FALLBACK_MODEL)
      // Keyboard turns never read the lever.
      expect(
        resolveInteractiveTurnSettings(
          db,
          {},
          { sessionId: 'sdk-ab', voiceModelOverride: VOICE_TIER_FALLBACK_MODEL },
          { logger: silentLogger },
        ).model,
      ).toBeUndefined()
    })
  })
})
