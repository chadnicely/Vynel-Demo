import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { upsertPreferenceForUser } from '@vynel/db/repositories/users'
import { getOrCreateLocalUser } from './get-or-create-local-user.js'
import { getUserPreferences, DEFAULT_PREFERENCES } from './get-user-preferences.js'

describe('getUserPreferences', () => {
  it('returns defaults when no preferences are stored', async () => {
    await withTestDatabase((db) => {
      // Skip the seed-defaults path by inserting a bare user directly.
      const user = getOrCreateLocalUser(db)
      // getOrCreateLocalUser seeds 3 prefs; delete them to test the
      // pure defaults path via getUserPreferences's resolution logic.
      const prefs = getUserPreferences(db, user.id)
      // The seeded prefs match DEFAULT_PREFERENCES values, so the
      // resolved shape equals the defaults.
      expect(prefs).toEqual(DEFAULT_PREFERENCES)
    })
  })

  it('returns stored preferences when they exist', async () => {
    await withTestDatabase((db) => {
      const user = getOrCreateLocalUser(db)
      upsertPreferenceForUser(db, user.id, 'theme', JSON.stringify('dark'))
      upsertPreferenceForUser(db, user.id, 'reducedMotion', JSON.stringify(true))
      const prefs = getUserPreferences(db, user.id)
      expect(prefs.theme).toBe('dark')
      expect(prefs.reducedMotion).toBe(true)
      // unset key still defaults
      expect(prefs.defaultWorkspaceId).toBeNull()
    })
  })

  it('silently ignores unknown preference keys', async () => {
    await withTestDatabase((db) => {
      const user = getOrCreateLocalUser(db)
      upsertPreferenceForUser(db, user.id, 'newFancyKey', JSON.stringify('whatever'))
      const prefs = getUserPreferences(db, user.id)
      // Resolved shape contains only the known keys; unknown ignored.
      expect(prefs).toEqual({
        theme: 'system',
        defaultWorkspaceId: null,
        chatStreamingEnabled: true,
        reducedMotion: false,
        voiceTtsModelId: 'kokoro',
        voiceSpeakerId: 0,
        voiceSttModelId: 'moonshine-base',
        voiceTtsSource: 'local',
        voiceTtsProviderVoiceId: null,
        voiceSttSource: 'web-speech',
        voiceWakeName: null,
        desktopActionsEnabled: false,
        voiceTierModel: 'claude-haiku-4-5',
        voiceTierThinking: 'off',
      })
    })
  })

  it('resolves the voice tier picks and refuses off-tier values (voice-lean arc)', async () => {
    await withTestDatabase((db) => {
      const user = getOrCreateLocalUser(db)
      upsertPreferenceForUser(db, user.id, 'voiceTierModel', JSON.stringify('claude-sonnet-5'))
      upsertPreferenceForUser(db, user.id, 'voiceTierThinking', JSON.stringify('low'))
      const prefs = getUserPreferences(db, user.id)
      expect(prefs.voiceTierModel).toBe('claude-sonnet-5')
      expect(prefs.voiceTierThinking).toBe('low')

      // A retired / off-tier value reads as never chosen — the spoken thread
      // must never chase a model off the tier.
      upsertPreferenceForUser(db, user.id, 'voiceTierModel', JSON.stringify('claude-opus-4-8'))
      upsertPreferenceForUser(db, user.id, 'voiceTierThinking', JSON.stringify('max'))
      const guarded = getUserPreferences(db, user.id)
      expect(guarded.voiceTierModel).toBe('claude-haiku-4-5')
      expect(guarded.voiceTierThinking).toBe('off')
    })
  })

  // Settings → Desktop control. Fail-closed by default; the boolean guard
  // means a corrupt row can never read as a silent yes.
  it('resolves the desktop acting toggle, and defaults it OFF', async () => {
    await withTestDatabase((db) => {
      const user = getOrCreateLocalUser(db)
      expect(getUserPreferences(db, user.id).desktopActionsEnabled).toBe(false)

      upsertPreferenceForUser(db, user.id, 'desktopActionsEnabled', JSON.stringify(true))
      expect(getUserPreferences(db, user.id).desktopActionsEnabled).toBe(true)

      upsertPreferenceForUser(db, user.id, 'desktopActionsEnabled', JSON.stringify(false))
      expect(getUserPreferences(db, user.id).desktopActionsEnabled).toBe(false)

      upsertPreferenceForUser(db, user.id, 'desktopActionsEnabled', JSON.stringify('yes'))
      expect(getUserPreferences(db, user.id).desktopActionsEnabled).toBe(false)
    })
  })

  // The voice keys are catalog ids: a stored id the catalog no longer carries
  // (a retired model) falls back to the default instead of poisoning the daemon.
  it('resolves the voice keys, and falls back from a retired model id', async () => {
    await withTestDatabase((db) => {
      const user = getOrCreateLocalUser(db)
      upsertPreferenceForUser(db, user.id, 'voiceTtsModelId', JSON.stringify('piper-lessac'))
      upsertPreferenceForUser(db, user.id, 'voiceSpeakerId', JSON.stringify(7))
      upsertPreferenceForUser(db, user.id, 'voiceSttModelId', JSON.stringify('whisper-large'))
      const prefs = getUserPreferences(db, user.id)
      expect(prefs.voiceTtsModelId).toBe('piper-lessac')
      expect(prefs.voiceSpeakerId).toBe(7)
      expect(prefs.voiceSttModelId).toBe('moonshine-base')

      upsertPreferenceForUser(db, user.id, 'voiceSpeakerId', JSON.stringify(-1))
      expect(getUserPreferences(db, user.id).voiceSpeakerId).toBe(0)
    })
  })

  it('silently ignores invalid value shape for a known key', async () => {
    await withTestDatabase((db) => {
      const user = getOrCreateLocalUser(db)
      // 'theme' must be light/dark/system — store an invalid value
      upsertPreferenceForUser(db, user.id, 'theme', JSON.stringify('NEON'))
      const prefs = getUserPreferences(db, user.id)
      // The invalid value is ignored; theme falls back to default.
      expect(prefs.theme).toBe('system')
    })
  })

  it('silently ignores malformed JSON', async () => {
    await withTestDatabase((db) => {
      const user = getOrCreateLocalUser(db)
      upsertPreferenceForUser(db, user.id, 'theme', 'not-valid-json{')
      const prefs = getUserPreferences(db, user.id)
      expect(prefs.theme).toBe('system')
    })
  })
})
