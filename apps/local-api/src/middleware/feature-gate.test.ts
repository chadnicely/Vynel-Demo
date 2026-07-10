// The tier gate over the real app: a basic entitlement 403s the pro-only
// subtrees with `feature_locked`, leaves channels open, and the gate stays
// PERMISSIVE with no entitlement (hub unconfigured / signed out — the
// lock-to-sign-in moment is a deferred product call).

import { describe, it, expect, vi } from 'vitest'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import type { HubSession } from '@vynel/hub-account'
import { createApp } from '../app.js'

const silentLogger = pino({ level: 'silent' })

function buildHubSession(features: string[] | null): HubSession {
  return {
    getStatus: vi.fn().mockReturnValue({ kind: 'signed-out' }),
    getEntitlement: vi.fn().mockReturnValue(
      features === null
        ? null
        : {
            accountId: 'a1',
            email: 'c@e.com',
            displayName: 'C',
            tier: 'basic',
            features,
            expiresAtMs: Date.now() + 1000000,
          },
    ),
    signIn: vi.fn(),
    signOut: vi.fn(),
    restore: vi.fn(),
    listDevices: vi.fn(),
    revokeDevice: vi.fn(),
  }
}

describe('featureGate', () => {
  it('403s feature_locked on gated subtrees for a basic entitlement', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({
        db,
        logger: silentLogger,
        hubSession: buildHubSession(['channels']),
      })
      for (const path of [
        '/schedules',
        '/workspaces/w1/knowledge',
        '/workspaces/w1/memory',
        '/workspaces/w1/marketplace',
        '/voice',
      ]) {
        const response = await app.request(path)
        expect(response.status).toBe(403)
        expect(((await response.json()) as { code: string }).code).toBe('feature_locked')
      }
      // Channels stay open on basic (some other status is fine — not 403).
      const channels = await app.request('/channels')
      expect(channels.status).not.toBe(403)
    })
  })

  it('stays permissive with a pro entitlement and with none at all', async () => {
    await withTestDatabase(async (db) => {
      const pro = createApp({
        db,
        logger: silentLogger,
        hubSession: buildHubSession(['channels', 'schedules', 'knowledge', 'memory']),
      })
      expect((await pro.request('/schedules')).status).not.toBe(403)

      const unconfigured = createApp({ db, logger: silentLogger })
      expect((await unconfigured.request('/schedules')).status).not.toBe(403)

      const signedOut = createApp({
        db,
        logger: silentLogger,
        hubSession: buildHubSession(null),
      })
      expect((await signedOut.request('/schedules')).status).not.toBe(403)
    })
  })
})
