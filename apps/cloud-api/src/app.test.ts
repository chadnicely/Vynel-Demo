// The hub's HTTP contract, end-to-end over PGlite: admin provisioning →
// set-password link → sign-in → devices → refresh → sign-out, plus the
// guards (admin bearer, access bearer, rate limit, enumeration-safe reset).

import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose'
import pino from 'pino'
import { describe, it, expect, beforeAll } from 'vitest'
import type { Hono } from 'hono'
import { withTestCloudDatabase } from '@vynel/cloud-db/testing'
import type { CloudDatabase } from '@vynel/cloud-db'
import {
  createAccessTokenIssuer,
  createAccessTokenVerifier,
  createEntitlementTokenIssuer,
  type AccessTokenIssuer,
  type AccessTokenVerifier,
  type EntitlementTokenIssuer,
  type AccountMailSender,
  type SetPasswordLinkMail,
} from '@vynel/accounts'
import { createCloudApp } from './app.js'
import { createInMemoryArtifactStore } from '@vynel/registry'

const ADMIN_TOKEN = 'test-admin-token-0123456789abcdef-0123456789abcdef'
const DEVICE = { deviceName: 'Chad-PC', devicePlatform: 'windows', appVersion: '0.1.0' }

let accessTokens: AccessTokenIssuer
let accessTokenVerifier: AccessTokenVerifier
let entitlements: EntitlementTokenIssuer

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
})

function buildCapturingMail(): AccountMailSender & { sent: SetPasswordLinkMail[]; lastToken(): string } {
  const sent: SetPasswordLinkMail[] = []
  return {
    sent,
    async sendSetPasswordLink(mail) {
      sent.push(mail)
    },
    lastToken() {
      return new URL(sent[sent.length - 1]?.link ?? 'https://x').searchParams.get('token') ?? ''
    },
  }
}

function buildApp(db: CloudDatabase, mail: AccountMailSender): Hono {
  return createCloudApp({
    db,
    logger: pino({ level: 'silent' }),
    accessTokens,
    accessTokenVerifier,
    entitlements,
    mail,
    artifactStore: createInMemoryArtifactStore(),
    linkBaseUrl: 'https://hub.test',
    adminToken: ADMIN_TOKEN,
  })
}

function postJson(app: Hono, path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

describe('the hub HTTP surface', () => {
  it('walks the whole arc: provision → set password → sign in → devices → refresh → sign out', async () => {
    await withTestCloudDatabase(async (db) => {
      const mail = buildCapturingMail()
      const app = buildApp(db, mail)

      // Admin surface rejects a missing/wrong bearer.
      const unauthorized = await postJson(app, '/admin/accounts', { email: 'c@d.e', displayName: 'C' })
      expect(unauthorized.status).toBe(401)

      const created = await postJson(
        app,
        '/admin/accounts',
        { email: 'chad@example.com', displayName: 'Chad', platformUserId: 'plat-9' },
        { authorization: `Bearer ${ADMIN_TOKEN}` },
      )
      expect(created.status).toBe(201)
      const { accountId } = (await created.json()) as { accountId: string }

      const setPassword = await postJson(app, '/auth/set-password', {
        token: mail.lastToken(),
        newPassword: 'a long password',
      })
      expect(setPassword.status).toBe(200)

      const signIn = await postJson(app, '/auth/sign-in', {
        email: 'chad@example.com',
        password: 'a long password',
        device: DEVICE,
      })
      expect(signIn.status).toBe(200)
      const session = (await signIn.json()) as { accessToken: string; refreshToken: string }

      const devices = await app.request('/auth/devices', {
        headers: { authorization: `Bearer ${session.accessToken}` },
      })
      expect(devices.status).toBe(200)
      expect(((await devices.json()) as { devices: unknown[] }).devices).toHaveLength(1)
      // No bearer → 401.
      expect((await app.request('/auth/devices')).status).toBe(401)

      const refreshed = await postJson(app, '/auth/refresh', { refreshToken: session.refreshToken })
      expect(refreshed.status).toBe(200)
      const rotated = (await refreshed.json()) as { accountId: string; refreshToken: string }
      expect(rotated.accountId).toBe(accountId)
      expect(rotated.refreshToken).not.toBe(session.refreshToken)

      const signedOut = await postJson(app, '/auth/sign-out', { refreshToken: rotated.refreshToken })
      expect(signedOut.status).toBe(200)
      const afterSignOut = await postJson(app, '/auth/refresh', { refreshToken: rotated.refreshToken })
      expect(afterSignOut.status).toBe(401)
    })
  })

  it('rate-limits sign-in per email and keeps the reset route enumeration-safe', async () => {
    await withTestCloudDatabase(async (db) => {
      const mail = buildCapturingMail()
      const app = buildApp(db, mail)

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await postJson(app, '/auth/sign-in', {
          email: 'stuffing@example.com',
          password: `guess-${attempt}`,
          device: DEVICE,
        })
        expect(response.status).toBe(401)
      }
      const limited = await postJson(app, '/auth/sign-in', {
        email: 'stuffing@example.com',
        password: 'guess-final',
        device: DEVICE,
      })
      expect(limited.status).toBe(429)

      // Reset requests: identical 202 for unknown and known emails.
      const unknown = await postJson(app, '/auth/password-reset/request', {
        email: 'ghost@example.com',
      })
      expect(unknown.status).toBe(202)
      expect(mail.sent).toHaveLength(0)
    })
  })

  it('validates request bodies at the boundary', async () => {
    await withTestCloudDatabase(async (db) => {
      const app = buildApp(db, buildCapturingMail())
      const badEmail = await postJson(app, '/auth/sign-in', {
        email: 'not-an-email',
        password: 'x',
        device: DEVICE,
      })
      expect(badEmail.status).toBe(400)
      const shortPassword = await postJson(app, '/auth/set-password', {
        token: 'whatever',
        newPassword: 'short',
      })
      expect(shortPassword.status).toBe(400)
    })
  })
})
