// The pairing test: the DESKTOP's `@vynel/hub-account` leaf driven against
// the REAL hub app over PGlite — the two sides of the contracts/hub wire
// exercised together. Lives on the app side (packages never import apps).

import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose'
import pino from 'pino'
import { describe, it, expect, beforeAll } from 'vitest'
import { withTestCloudDatabase } from '@vynel/cloud-db/testing'
import { setAccountStatus } from '@vynel/cloud-db/repositories/accounts'
import {
  createAccessTokenIssuer,
  createAccessTokenVerifier,
  createEntitlementTokenIssuer,
  createProvisionedAccount,
  confirmSetPassword,
  type AccessTokenIssuer,
  type AccessTokenVerifier,
  type EntitlementTokenIssuer,
  type AccountMailSender,
  type SetPasswordLinkMail,
} from '@vynel/accounts'
import {
  createEntitlementVerifier,
  createHubClient,
  createHubSession,
  createInMemoryRefreshTokenVault,
  type EntitlementVerifier,
} from '@vynel/hub-account'
import type { Hono } from 'hono'
import { createCloudApp } from './app.js'
import { createInMemoryArtifactStore } from './artifacts/artifact-store.js'

const DEVICE = { deviceName: 'Chad-PC', devicePlatform: 'windows', appVersion: '0.1.0' }
const silentLogger = pino({ level: 'silent' })

let accessTokens: AccessTokenIssuer
let accessTokenVerifier: AccessTokenVerifier
let entitlements: EntitlementTokenIssuer
let entitlementVerifier: EntitlementVerifier

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair('EdDSA', { extractable: true })
  accessTokens = await createAccessTokenIssuer({
    privateKeyPem: await exportPKCS8(privateKey),
    ttlSeconds: 3600,
  })
  accessTokenVerifier = await createAccessTokenVerifier({
    publicKeyPem: await exportSPKI(publicKey),
  })
  entitlements = await createEntitlementTokenIssuer({
    privateKeyPem: await exportPKCS8(privateKey),
    keyId: 'test-key',
  })
  entitlementVerifier = await createEntitlementVerifier({
    publicKeyPem: await exportSPKI(publicKey),
  })
})

/** Route the leaf's fetch straight into the Hono app — no sockets. */
function appFetch(app: Hono): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) =>
    app.request(input as string, init)) as typeof fetch
}

describe('hub-account against the real hub', () => {
  it('signs in, restores (rotating), lists + revokes devices, and locks on disable', async () => {
    await withTestCloudDatabase(async (db) => {
      const sent: SetPasswordLinkMail[] = []
      const mail: AccountMailSender = {
        async sendSetPasswordLink(m) {
          sent.push(m)
        },
      }
      const app = createCloudApp({
        db,
        logger: silentLogger,
        accessTokens,
        accessTokenVerifier,
        entitlements,
        mail,
        artifactStore: createInMemoryArtifactStore(),
        linkBaseUrl: 'https://hub.test',
        adminToken: 'test-admin-token-0123456789abcdef-0123456789abcdef',
      })

      const { accountId } = await createProvisionedAccount(
        db,
        { email: 'chad@example.com', displayName: 'Chad' },
        { mail, linkBaseUrl: 'https://hub.test' },
      )
      const inviteToken =
        new URL(sent[0]?.link ?? 'https://x').searchParams.get('token') ?? ''
      await confirmSetPassword(db, { token: inviteToken, newPassword: 'a long password' }, {})

      const vault = createInMemoryRefreshTokenVault()
      const session = createHubSession({
        client: createHubClient({ baseUrl: '', fetchFn: appFetch(app) }),
        vault,
        entitlementVault: createInMemoryRefreshTokenVault(),
        entitlements: entitlementVerifier,
        device: DEVICE,
        logger: silentLogger,
      })

      // Sign in → signed-in; the vault holds the rotating secret.
      const signedIn = await session.signIn({
        email: 'chad@example.com',
        password: 'a long password',
      })
      expect(signedIn).toMatchObject({ kind: 'signed-in', displayName: 'Chad' })
      const storedAfterSignIn = await vault.load()
      expect(storedAfterSignIn).not.toBeNull()

      // The boot check: rotation happens for real.
      const restored = await session.restore()
      expect(restored).toMatchObject({ kind: 'signed-in' })
      expect(await vault.load()).not.toBe(storedAfterSignIn)

      // Devices through the leaf: one live device; revoking it kills the
      // session server-side → the next boot check is signed-out.
      const devices = await session.listDevices()
      expect(devices).toHaveLength(1)
      await session.revokeDevice(devices[0]?.id ?? '')
      expect(await session.restore()).toEqual({ kind: 'signed-out' })

      // Fresh sign-in, then the account gets disabled → the boot check LOCKS.
      await session.signIn({ email: 'chad@example.com', password: 'a long password' })
      await setAccountStatus(db, { accountId, status: 'disabled' })
      const locked = await session.restore()
      expect(locked).toMatchObject({ kind: 'locked' })
      expect(await vault.load()).toBeNull()
    })
  })

  it('wrong password surfaces the hub generic error through the leaf', async () => {
    await withTestCloudDatabase(async (db) => {
      const app = createCloudApp({
        db,
        logger: silentLogger,
        accessTokens,
        accessTokenVerifier,
        entitlements,
        mail: { sendSetPasswordLink: async () => {} },
        artifactStore: createInMemoryArtifactStore(),
        linkBaseUrl: 'https://hub.test',
        adminToken: 'test-admin-token-0123456789abcdef-0123456789abcdef',
      })
      const session = createHubSession({
        client: createHubClient({ baseUrl: '', fetchFn: appFetch(app) }),
        vault: createInMemoryRefreshTokenVault(),
        entitlementVault: createInMemoryRefreshTokenVault(),
        entitlements: entitlementVerifier,
        device: DEVICE,
        logger: silentLogger,
      })
      await expect(
        session.signIn({ email: 'nobody@example.com', password: 'whatever' }),
      ).rejects.toMatchObject({ code: 'unauthorized', message: 'Wrong email or password.' })
    })
  })
})
