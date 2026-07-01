import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { getOrCreateLocalUser } from './get-or-create-local-user.js'
import { setUserPreferences } from './set-user-preferences.js'
import { getUserPreferences } from './get-user-preferences.js'
import { listPreferencesForUser } from '@vynel/db/repositories/users'

describe('setUserPreferences', () => {
  it('upserts a single preference and round-trips through getUserPreferences', async () => {
    await withTestDatabase((db) => {
      const user = getOrCreateLocalUser(db)
      setUserPreferences(db, user.id, { theme: 'dark' })
      const prefs = getUserPreferences(db, user.id)
      expect(prefs.theme).toBe('dark')
    })
  })

  it('upserts multiple preferences in a single call', async () => {
    await withTestDatabase((db) => {
      const user = getOrCreateLocalUser(db)
      setUserPreferences(db, user.id, {
        theme: 'light',
        chatStreamingEnabled: false,
        defaultWorkspaceId: 'workspace-123',
      })
      const prefs = getUserPreferences(db, user.id)
      expect(prefs.theme).toBe('light')
      expect(prefs.chatStreamingEnabled).toBe(false)
      expect(prefs.defaultWorkspaceId).toBe('workspace-123')
    })
  })

  it('is a no-op when the input is empty', async () => {
    await withTestDatabase((db) => {
      const user = getOrCreateLocalUser(db)
      const before = listPreferencesForUser(db, user.id).length
      setUserPreferences(db, user.id, {})
      const after = listPreferencesForUser(db, user.id).length
      expect(after).toBe(before)
    })
  })

  it('is atomic — a later failure rolls back earlier upserts', async () => {
    await withTestDatabase((db) => {
      const user = getOrCreateLocalUser(db)
      // Capture the current theme value (seeded by getOrCreateLocalUser)
      const themeBefore = getUserPreferences(db, user.id).theme

      // Mix a valid theme update with a value that will fail JSON.stringify
      // (e.g., a BigInt — JSON.stringify throws for BigInt).
      const offendingValue = BigInt(1) as unknown as boolean
      expect(() =>
        setUserPreferences(db, user.id, {
          theme: 'dark',
          reducedMotion: offendingValue,
        }),
      ).toThrow()

      // After the throw, theme should still be its previous value
      // (rollback restored the pre-tx state).
      const themeAfter = getUserPreferences(db, user.id).theme
      expect(themeAfter).toBe(themeBefore)
    })
  })
})
