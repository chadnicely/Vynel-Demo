// The session state machine against a STUBBED client — every restore verdict
// (signed-in / signed-out / locked / offline), sign-out resilience, and the
// access-token retry. The real-hub integration lives in apps/cloud-api
// (packages never import apps, so the pairing test sits on the app side).

import { createHash, generateKeyPairSync } from 'node:crypto'
import { describe, it, expect, vi } from 'vitest'
import pino from 'pino'
import { ForbiddenError, UnauthorizedError } from '@vynel/errors'
import { signArtifactSha256 } from '@vynel/contracts/hub/artifact-signing'
import type { HubSessionResponse } from '@vynel/contracts/hub/hub-auth'
import type { HubClient } from '../client/hub-client.js'
import { createInMemoryRefreshTokenVault } from '../vault/refresh-token-vault.js'
import { createHubSession } from './hub-session.js'

const DEVICE = { deviceName: 'Chad-PC', devicePlatform: 'windows', appVersion: '0.1.0' }
const silentLogger = pino({ level: 'silent' })

// A verifier that accepts the fake 'ent-1' token from sessionResponse().
const fakeEntitlements = {
  verify: vi.fn().mockResolvedValue({
    accountId: 'acc-1',
    email: 'chad@example.com',
    displayName: 'Chad',
    tier: 'pro',
    features: ['channels', 'voice'],
    expiresAtMs: Date.now() + 1_000_000,
  }),
}

function sessionResponse(overrides: Partial<HubSessionResponse> = {}): HubSessionResponse {
  return {
    accountId: 'acc-1',
    email: 'chad@example.com',
    displayName: 'Chad',
    accessToken: 'access-1',
    accessTokenExpiresAt: new Date().toISOString(),
    refreshToken: 'refresh-2',
    entitlementToken: 'ent-1',
    ...overrides,
  }
}

function buildClient(overrides: Partial<HubClient> = {}): HubClient {
  return {
    signIn: vi.fn().mockResolvedValue(sessionResponse()),
    refresh: vi.fn().mockResolvedValue(sessionResponse()),
    signOut: vi.fn().mockResolvedValue(undefined),
    listDevices: vi.fn().mockResolvedValue({ devices: [] }),
    revokeDevice: vi.fn().mockResolvedValue(undefined),
    getCatalog: vi.fn().mockResolvedValue({ items: [] }),
    downloadArtifact: vi.fn().mockResolvedValue({ bytes: Buffer.from(''), signature: null }),
    ...overrides,
  }
}

describe('createHubSession', () => {
  it('restore with no stored token is signed-out', async () => {
    const session = createHubSession({
      client: buildClient(),
      vault: createInMemoryRefreshTokenVault(),
      entitlementVault: createInMemoryRefreshTokenVault(),
      entitlements: fakeEntitlements,
      device: DEVICE,
      logger: silentLogger,
    })
    expect(await session.restore()).toEqual({ kind: 'signed-out' })
  })

  it('restore rotates the vaulted token and lands signed-in', async () => {
    const vault = createInMemoryRefreshTokenVault('refresh-1')
    const client = buildClient()
    const session = createHubSession({ client, vault, entitlementVault: createInMemoryRefreshTokenVault(), entitlements: fakeEntitlements, device: DEVICE, logger: silentLogger })
    const status = await session.restore()
    expect(status).toMatchObject({ kind: 'signed-in', email: 'chad@example.com' })
    expect(client.refresh).toHaveBeenCalledWith({ refreshToken: 'refresh-1' })
    expect(await vault.load()).toBe('refresh-2')
  })

  it('a 401 verdict clears the vault (signed-out); a 403 locks', async () => {
    const unauthorizedVault = createInMemoryRefreshTokenVault('dead-token')
    const unauthorized = createHubSession({
      client: buildClient({ refresh: vi.fn().mockRejectedValue(new UnauthorizedError('expired')) }),
      vault: unauthorizedVault,
      entitlementVault: createInMemoryRefreshTokenVault(),
      entitlements: fakeEntitlements,
      device: DEVICE,
      logger: silentLogger,
    })
    expect(await unauthorized.restore()).toEqual({ kind: 'signed-out' })
    expect(await unauthorizedVault.load()).toBeNull()

    const lockedVault = createInMemoryRefreshTokenVault('revoked-token')
    const locked = createHubSession({
      client: buildClient({
        refresh: vi.fn().mockRejectedValue(new ForbiddenError('This account is disabled.')),
      }),
      vault: lockedVault,
      entitlementVault: createInMemoryRefreshTokenVault(),
      entitlements: fakeEntitlements,
      device: DEVICE,
      logger: silentLogger,
    })
    expect(await locked.restore()).toEqual({
      kind: 'locked',
      message: 'This account is disabled.',
    })
    expect(await lockedVault.load()).toBeNull()
  })

  it('an unreachable hub is offline: vault kept, cached identity carried', async () => {
    const vault = createInMemoryRefreshTokenVault('refresh-1')
    const refresh = vi
      .fn()
      .mockResolvedValueOnce(sessionResponse())
      .mockRejectedValue(new TypeError('fetch failed'))
    const session = createHubSession({
      client: buildClient({ refresh }),
      vault,
      entitlementVault: createInMemoryRefreshTokenVault(),
      entitlements: fakeEntitlements,
      device: DEVICE,
      logger: silentLogger,
    })
    await session.restore() // signed-in, identity cached
    const offline = await session.restore()
    expect(offline).toMatchObject({
      kind: 'offline',
      email: 'chad@example.com',
      displayName: 'Chad',
      tier: 'pro',
    })
    expect(await vault.load()).toBe('refresh-2')
  })

  it('sign-out clears locally even when the hub is unreachable', async () => {
    const vault = createInMemoryRefreshTokenVault('refresh-1')
    const session = createHubSession({
      client: buildClient({ signOut: vi.fn().mockRejectedValue(new TypeError('fetch failed')) }),
      vault,
      entitlementVault: createInMemoryRefreshTokenVault(),
      entitlements: fakeEntitlements,
      device: DEVICE,
      logger: silentLogger,
    })
    expect(await session.signOut()).toEqual({ kind: 'signed-out' })
    expect(await vault.load()).toBeNull()
  })

  it('devices calls retry once after an aged-out access token', async () => {
    const vault = createInMemoryRefreshTokenVault('refresh-1')
    const listDevices = vi
      .fn()
      .mockRejectedValueOnce(new UnauthorizedError('token expired'))
      .mockResolvedValue({ devices: [{ id: 'd1' }] })
    const client = buildClient({ listDevices })
    const session = createHubSession({ client, vault, entitlementVault: createInMemoryRefreshTokenVault(), entitlements: fakeEntitlements, device: DEVICE, logger: silentLogger })
    await session.restore()
    const devices = await session.listDevices()
    expect(devices).toEqual([{ id: 'd1' }])
    expect(client.refresh).toHaveBeenCalledTimes(2) // boot restore + retry restore
  })
})

describe('downloadArtifact signature verification', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const bytes = Buffer.from('artifact zip bytes')
  const sha256Hex = createHash('sha256').update(bytes).digest('hex')
  const validSignature = signArtifactSha256(privatePem, sha256Hex)

  function sessionWith(download: { bytes: Buffer; signature: string | null }, pinnedKey?: string) {
    return createHubSession({
      client: buildClient({ downloadArtifact: vi.fn().mockResolvedValue(download) }),
      vault: createInMemoryRefreshTokenVault('refresh-1'),
      entitlementVault: createInMemoryRefreshTokenVault(),
      entitlements: fakeEntitlements,
      device: DEVICE,
      logger: silentLogger,
      ...(pinnedKey !== undefined ? { artifactSigningPublicKeyPem: pinnedKey } : {}),
    })
  }

  it('returns the bytes when the signature verifies against the pinned key', async () => {
    const session = sessionWith({ bytes, signature: validSignature }, publicPem)
    expect(await session.downloadArtifact('canvas-design', '1.0.0')).toEqual(bytes)
  })

  it('refuses TAMPERED bytes — a valid-looking signature over the wrong sha never returns', async () => {
    const session = sessionWith({ bytes: Buffer.from('swapped bytes'), signature: validSignature }, publicPem)
    await expect(session.downloadArtifact('canvas-design', '1.0.0')).rejects.toThrow(
      /signature check/,
    )
  })

  it('passes UNSIGNED versions through (rollout: hub published before the key existed)', async () => {
    const session = sessionWith({ bytes, signature: null }, publicPem)
    expect(await session.downloadArtifact('canvas-design', '1.0.0')).toEqual(bytes)
  })

  it('skips verification entirely without a pinned key (rollout: desktop not configured)', async () => {
    const session = sessionWith({ bytes, signature: 'garbage-signature' })
    expect(await session.downloadArtifact('canvas-design', '1.0.0')).toEqual(bytes)
  })
})
