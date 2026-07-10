// The /hub routes: the not-configured contract (no VYNEL_HUB_URL → status
// answers, mutations 400 with the env hint) and the thin delegation to an
// injected HubSession. Full HTTP stack over the real SQLite test db.

import { describe, it, expect, vi } from 'vitest'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import type { HubSession } from '@vynel/hub-account'
import { createApp } from '../../app.js'

const silentLogger = pino({ level: 'silent' })

function buildFakeHubSession(overrides: Partial<HubSession> = {}): HubSession {
  return {
    getStatus: vi.fn().mockReturnValue({
      kind: 'signed-in',
      email: 'chad@example.com',
      displayName: 'Chad',
      checkedAt: '2026-07-10T00:00:00.000Z',
      tier: 'pro',
      features: ['channels'],
    }),
    getEntitlement: vi.fn().mockReturnValue(null),
    signIn: vi.fn().mockResolvedValue({
      kind: 'signed-in',
      email: 'chad@example.com',
      displayName: 'Chad',
      checkedAt: '2026-07-10T00:00:00.000Z',
      tier: 'pro',
      features: ['channels'],
    }),
    signOut: vi.fn().mockResolvedValue({ kind: 'signed-out' }),
    restore: vi.fn().mockResolvedValue({ kind: 'signed-out' }),
    listDevices: vi.fn().mockResolvedValue([]),
    revokeDevice: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('hub routes — not configured (no VYNEL_HUB_URL)', () => {
  it('GET /hub/session answers not-configured instead of erroring', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const res = await app.request('/hub/session')
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ kind: 'not-configured' })
    })
  })

  it('mutations answer 400 with the actionable env hint', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger })
      const res = await app.request('/hub/sign-in', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'a@example.com', password: 'x' }),
      })
      expect(res.status).toBe(400)
      expect(((await res.json()) as { message: string }).message).toContain('VYNEL_HUB_URL')
    })
  })
})

describe('hub routes — configured', () => {
  it('delegates session, sign-in, devices, and revoke to the hub session', async () => {
    await withTestDatabase(async (db) => {
      const hubSession = buildFakeHubSession({
        listDevices: vi.fn().mockResolvedValue([
          {
            id: 'd1',
            deviceName: 'Chad-PC',
            devicePlatform: 'windows',
            appVersion: '0.0.0',
            lastUsedAt: '2026-07-10T00:00:00.000Z',
            expiresAt: '2027-07-10T00:00:00.000Z',
          },
        ]),
      })
      const app = createApp({ db, logger: silentLogger, hubSession })

      const session = await app.request('/hub/session')
      expect(await session.json()).toMatchObject({ kind: 'signed-in', displayName: 'Chad' })

      const signIn = await app.request('/hub/sign-in', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'chad@example.com', password: 'a long password' }),
      })
      expect(signIn.status).toBe(200)
      expect(hubSession.signIn).toHaveBeenCalledWith({
        email: 'chad@example.com',
        password: 'a long password',
      })

      const devices = await app.request('/hub/devices')
      expect(((await devices.json()) as { devices: unknown[] }).devices).toHaveLength(1)

      const revoke = await app.request('/hub/devices/d1', { method: 'DELETE' })
      expect(await revoke.json()).toEqual({ revoked: true })
      expect(hubSession.revokeDevice).toHaveBeenCalledWith('d1')

      const signOut = await app.request('/hub/sign-out', { method: 'POST' })
      expect(await signOut.json()).toEqual({ kind: 'signed-out' })
    })
  })

  it('rejects a malformed sign-in body at the boundary', async () => {
    await withTestDatabase(async (db) => {
      const app = createApp({ db, logger: silentLogger, hubSession: buildFakeHubSession() })
      const res = await app.request('/hub/sign-in', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'not-an-email', password: '' }),
      })
      expect(res.status).toBe(400)
    })
  })
})
