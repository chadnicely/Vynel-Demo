// Integration tests for the discovered-model-roster ops — persist on first
// sight, upsert without disturbing other settings, no-op on empty/unchanged
// rosters, and fail-soft reads. Real SQLite via `withTestDatabase`.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { listProviderPreferencesForUser } from '@vynel/db/repositories/providers'
import type { DiscoveredChatModel } from '@vynel/contracts/chat/available-models'
import { findDiscoveredModels, recordDiscoveredModels } from './discovered-models.js'
import { setDefaultProviderForUser } from './set-default-provider-for-user.js'

function makeUser(id: string = randomUUID()) {
  return {
    id,
    displayName: 'Test',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

function makeModel(id: string): DiscoveredChatModel {
  return { id, label: id, description: null, supportedEffortLevels: null }
}

describe('discovered models roster', () => {
  it('persists on first sight and reads back', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)

      recordDiscoveredModels(db, {
        userId: user.id,
        providerId: 'claude',
        models: [makeModel('claude-opus-5'), makeModel('claude-sonnet-5')],
      })

      const roster = findDiscoveredModels(db, user.id, 'claude')
      expect(roster?.map((m) => m.id)).toEqual(['claude-opus-5', 'claude-sonnet-5'])
    })
  })

  it('updates an existing preference row without disturbing its other settings', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      setDefaultProviderForUser(db, { userId: user.id, providerId: 'claude' })

      recordDiscoveredModels(db, {
        userId: user.id,
        providerId: 'claude',
        models: [makeModel('claude-opus-5')],
      })

      const preferences = listProviderPreferencesForUser(db, user.id)
      expect(preferences).toHaveLength(1)
      expect(preferences[0]?.isDefault).toBe(true)
      expect(findDiscoveredModels(db, user.id, 'claude')?.map((m) => m.id)).toEqual([
        'claude-opus-5',
      ])
    })
  })

  it('an empty roster never wipes a stored one', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      recordDiscoveredModels(db, {
        userId: user.id,
        providerId: 'claude',
        models: [makeModel('claude-opus-5')],
      })

      recordDiscoveredModels(db, { userId: user.id, providerId: 'claude', models: [] })

      expect(findDiscoveredModels(db, user.id, 'claude')).not.toBeNull()
    })
  })

  it('an unchanged roster does not churn the row', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const models = [makeModel('claude-opus-5')]
      recordDiscoveredModels(db, { userId: user.id, providerId: 'claude', models })
      const [before] = listProviderPreferencesForUser(db, user.id)

      recordDiscoveredModels(db, { userId: user.id, providerId: 'claude', models })

      const [after] = listProviderPreferencesForUser(db, user.id)
      expect(after?.updatedAt).toEqual(before?.updatedAt)
    })
  })

  it('reads null before any discovery', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      expect(findDiscoveredModels(db, user.id, 'claude')).toBeNull()
    })
  })

  it('a corrupt blob degrades to null; a partial entry normalizes to the full shape', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      setDefaultProviderForUser(db, {
        userId: user.id,
        providerId: 'claude',
        initialSettings: {
          providerSpecific: { discoveredModels: 'not-an-array' },
        },
      })
      expect(findDiscoveredModels(db, user.id, 'claude')).toBeNull()

      setDefaultProviderForUser(db, {
        userId: user.id,
        providerId: 'codex',
        initialSettings: {
          // One junk entry + one PARTIAL entry (an older writer's shape).
          providerSpecific: { discoveredModels: [42, { id: 'claude-opus-5', label: 'Opus 5' }] },
        },
      })
      expect(findDiscoveredModels(db, user.id, 'codex')).toEqual([
        {
          id: 'claude-opus-5',
          label: 'Opus 5',
          description: null,
          supportedEffortLevels: null,
        },
      ])
    })
  })
})
