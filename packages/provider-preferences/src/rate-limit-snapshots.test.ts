// Integration tests for the rate-limit-snapshot ops — persist on first sight,
// per-window overwrite that never disturbs sibling windows or other settings,
// and fail-soft reads. Real SQLite via `withTestDatabase`.

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import {
  listProviderPreferencesForUser,
  updateProviderPreference,
} from '@vynel/db/repositories/providers'
import { findDiscoveredModels, recordDiscoveredModels } from './discovered-models.js'
import { listRateLimitSnapshots, recordRateLimitSnapshot } from './rate-limit-snapshots.js'

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

describe('rate limit snapshots', () => {
  it('persists on first sight and reads back with a capture stamp', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)

      recordRateLimitSnapshot(db, {
        userId: user.id,
        providerId: 'claude',
        snapshot: {
          windowKind: 'seven_day',
          status: 'allowed',
          utilization: 14,
          resetsAt: '2026-08-19T15:00:00.000Z',
        },
      })

      const snapshots = listRateLimitSnapshots(db, user.id, 'claude')
      expect(snapshots).toHaveLength(1)
      expect(snapshots[0]).toMatchObject({
        windowKind: 'seven_day',
        status: 'allowed',
        utilization: 14,
        resetsAt: '2026-08-19T15:00:00.000Z',
      })
      expect(typeof snapshots[0]!.capturedAt).toBe('string')
    })
  })

  it('overwrites only its own window — the seven-day reading survives a five-hour update', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      const record = (windowKind: string, utilization: number) =>
        recordRateLimitSnapshot(db, {
          userId: user.id,
          providerId: 'claude',
          snapshot: { windowKind, status: 'allowed', utilization, resetsAt: null },
        })

      record('seven_day', 14)
      record('five_hour', 2)
      record('five_hour', 9)

      const byWindow = Object.fromEntries(
        listRateLimitSnapshots(db, user.id, 'claude').map((s) => [s.windowKind, s.utilization]),
      )
      expect(byWindow).toEqual({ seven_day: 14, five_hour: 9 })
    })
  })

  it('shares the preference row with the model roster without disturbing it', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      recordDiscoveredModels(db, {
        userId: user.id,
        providerId: 'claude',
        models: [{ id: 'claude-opus-5', label: 'Opus', description: null, supportedEffortLevels: null }],
      })

      recordRateLimitSnapshot(db, {
        userId: user.id,
        providerId: 'claude',
        snapshot: { windowKind: 'five_hour', status: 'allowed_warning', utilization: 82, resetsAt: null },
      })

      expect(findDiscoveredModels(db, user.id, 'claude')?.[0]?.id).toBe('claude-opus-5')
      expect(listRateLimitSnapshots(db, user.id, 'claude')[0]?.status).toBe('allowed_warning')
    })
  })

  it('reads an absent or corrupt blob as empty, never as a broken popup', async () => {
    await withTestDatabase(async (db) => {
      const user = makeUser()
      insertUser(db, user)
      expect(listRateLimitSnapshots(db, user.id, 'claude')).toEqual([])

      // Corrupt: an older/broken writer left junk under the key.
      recordRateLimitSnapshot(db, {
        userId: user.id,
        providerId: 'claude',
        snapshot: { windowKind: 'five_hour', status: 'allowed', utilization: 1, resetsAt: null },
      })
      const preference = listProviderPreferencesForUser(db, user.id)[0]!
      updateProviderPreference(db, preference.id, {
        defaultSettings: {
          providerSpecific: { rateLimits: ['garbage', { windowKind: 42 }] },
        },
      })
      expect(listRateLimitSnapshots(db, user.id, 'claude')).toEqual([])
    })
  })
})
