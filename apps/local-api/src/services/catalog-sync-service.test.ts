// The catalog-sync tick's status-keyed behavior over the real product DB:
// signed-in → cache populated; offline → cache KEPT; signed-out → cache
// CLEARED. Uses a fake HubSession; the marketplace sync/read is real.

import { describe, it, expect, vi } from 'vitest'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { UnauthorizedError } from '@vynel/errors'
import { syncCloudCatalog, resolveMergedCatalog } from '@vynel/marketplace'
import type { HubSession } from '@vynel/hub-account'
import type { HubCatalogItem } from '@vynel/contracts/hub/catalog'
import { startCatalogSyncService } from './catalog-sync-service.js'

const silentLogger = pino({ level: 'silent' })

function item(itemId: string): HubCatalogItem {
  return {
    itemId,
    kind: 'skill',
    publisherName: 'Vynel Team',
    publisherTier: 'verified',
    publisherUrl: null,
    displayName: itemId,
    oneLineDescription: 'x',
    category: 'email',
    iconName: 'mail',
    recommendedScope: 'user',
    minimumTier: 'basic',
    latestVersion: '1.0.0',
    latestVersionSha256: 'a'.repeat(64),
    releasedAt: '2026-07-10T00:00:00.000Z',
    canInstall: true,
  }
}

function fakeSession(over: Partial<HubSession>): HubSession {
  return {
    getStatus: vi.fn().mockReturnValue({ kind: 'signed-out' }),
    getEntitlement: vi.fn().mockReturnValue(null),
    signIn: vi.fn(),
    signOut: vi.fn(),
    restore: vi.fn(),
    listDevices: vi.fn(),
    revokeDevice: vi.fn(),
    fetchCatalog: vi.fn(),
    ...over,
  }
}

/** Let the service's fire-and-forget boot sync settle. */
const flush = () => new Promise((r) => setTimeout(r, 5))

describe('startCatalogSyncService', () => {
  it('populates the cache when signed-in', async () => {
    await withTestDatabase(async (db) => {
      const hubSession = fakeSession({ fetchCatalog: vi.fn().mockResolvedValue([item('pro-skill')]) })
      const service = startCatalogSyncService({ hubSession, db, logger: silentLogger, intervalMs: 9_999_999 })
      await flush()
      expect(resolveMergedCatalog(db).map((i) => i.itemId)).toContain('pro-skill')
      service.stop()
    })
  })

  it('KEEPS the cache when offline (fetch fails, status offline)', async () => {
    await withTestDatabase(async (db) => {
      syncCloudCatalog(db, [item('pro-skill')], new Date()) // pre-seed the cache
      const hubSession = fakeSession({
        fetchCatalog: vi.fn().mockRejectedValue(new Error('network')),
        getStatus: vi.fn().mockReturnValue({ kind: 'offline', email: null, displayName: null, tier: null, features: [] }),
      })
      const service = startCatalogSyncService({ hubSession, db, logger: silentLogger, intervalMs: 9_999_999 })
      await flush()
      expect(resolveMergedCatalog(db).map((i) => i.itemId)).toContain('pro-skill')
      service.stop()
    })
  })

  it('KEEPS the cache on a TRANSIENT failure while still signed-in', async () => {
    await withTestDatabase(async (db) => {
      syncCloudCatalog(db, [item('pro-skill')], new Date()) // pre-seed
      // A network/5xx failure does NOT flip status (no restore fired) — status
      // stays signed-in. The cache must survive the blip.
      const hubSession = fakeSession({
        fetchCatalog: vi.fn().mockRejectedValue(new Error('hub 502')),
        getStatus: vi.fn().mockReturnValue({
          kind: 'signed-in',
          email: 'c@e.com',
          displayName: 'C',
          checkedAt: 'now',
          tier: 'pro',
          features: ['channels'],
        }),
      })
      const service = startCatalogSyncService({ hubSession, db, logger: silentLogger, intervalMs: 9_999_999 })
      await flush()
      expect(resolveMergedCatalog(db).map((i) => i.itemId)).toContain('pro-skill')
      service.stop()
    })
  })

  it('CLEARS the cache when signed-out', async () => {
    await withTestDatabase(async (db) => {
      syncCloudCatalog(db, [item('pro-skill')], new Date())
      const hubSession = fakeSession({
        fetchCatalog: vi.fn().mockRejectedValue(new UnauthorizedError('nope')),
        getStatus: vi.fn().mockReturnValue({ kind: 'signed-out' }),
      })
      const service = startCatalogSyncService({ hubSession, db, logger: silentLogger, intervalMs: 9_999_999 })
      await flush()
      expect(resolveMergedCatalog(db).map((i) => i.itemId)).not.toContain('pro-skill')
      service.stop()
    })
  })
})
