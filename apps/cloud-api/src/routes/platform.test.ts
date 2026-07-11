// The platform webhook contract: HMAC + replay-window guards, idempotent
// user lifecycle (created → duplicate-created converges → tier.updated →
// user.removed kills sessions), and the disabled-surface 503.

import { createHmac } from 'node:crypto'
import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose'
import pino from 'pino'
import { describe, it, expect, beforeAll } from 'vitest'
import type { Hono } from 'hono'
import { withTestCloudDatabase } from '@vynel/cloud-db/testing'
import type { CloudDatabase } from '@vynel/cloud-db'
import { findAccountByPlatformUserId } from '@vynel/cloud-db/repositories/accounts'
import {
  createAccessTokenIssuer,
  createAccessTokenVerifier,
  createEntitlementTokenIssuer,
  type AccessTokenIssuer,
  type AccessTokenVerifier,
  type EntitlementTokenIssuer,
} from '@vynel/accounts'
import { createCloudApp } from './../app.js'
import { createInMemoryArtifactStore } from '@vynel/registry'

const SECRET = 'webhook-secret-0123456789abcdef-0123456789abcdef'
const silentLogger = pino({ level: 'silent' })

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

function buildApp(db: CloudDatabase, withSecret = true): Hono {
  return createCloudApp({
    db,
    logger: silentLogger,
    accessTokens,
    accessTokenVerifier,
    entitlements,
    mail: { sendSetPasswordLink: async () => {} },
    artifactStore: createInMemoryArtifactStore(),
    linkBaseUrl: 'https://hub.test',
    adminToken: 'test-admin-token-0123456789abcdef-0123456789abcdef',
    ...(withSecret ? { platformWebhookSecret: SECRET } : {}),
  })
}

function signedRequest(app: Hono, body: unknown, options: { timestamp?: number; badSignature?: boolean } = {}) {
  const rawBody = JSON.stringify(body)
  const timestamp = String(options.timestamp ?? Math.floor(Date.now() / 1000))
  const signature = options.badSignature
    ? 'ab'.repeat(32)
    : createHmac('sha256', SECRET).update(`${timestamp}.${rawBody}`).digest('hex')
  return app.request('/platform/webhooks', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-vynel-timestamp': timestamp,
      'x-vynel-signature': signature,
    },
    body: rawBody,
  })
}

describe('platform webhooks', () => {
  it('rejects bad signatures, stale timestamps, and answers 503 when unconfigured', async () => {
    await withTestCloudDatabase(async (db) => {
      const app = buildApp(db)
      const event = { id: 'e1', type: 'user.created', platformUserId: 'p1', email: 'a@example.com', displayName: 'A' }
      expect((await signedRequest(app, event, { badSignature: true })).status).toBe(401)
      expect(
        (await signedRequest(app, event, { timestamp: Math.floor(Date.now() / 1000) - 600 })).status,
      ).toBe(401)
      const disabled = buildApp(db, false)
      expect((await signedRequest(disabled, event)).status).toBe(503)
      // Nothing was created by the rejected calls.
      expect(await findAccountByPlatformUserId(db, 'p1')).toBeNull()
    })
  })

  it('runs the lifecycle idempotently: created (×2) → tier.updated → user.removed', async () => {
    await withTestCloudDatabase(async (db) => {
      const app = buildApp(db)
      const created = await signedRequest(app, {
        id: 'e1',
        type: 'user.created',
        platformUserId: 'p9',
        email: 'student@example.com',
        displayName: 'Student',
        tier: 'basic',
      })
      expect(created.status).toBe(200)
      expect(await created.json()).toMatchObject({ outcome: 'created' })

      // The platform retries the SAME event id: deduped, acknowledged, not
      // re-applied (exactly-once).
      const replay = await signedRequest(app, {
        id: 'e1',
        type: 'user.created',
        platformUserId: 'p9',
        email: 'student@example.com',
        displayName: 'Student',
      })
      expect(await replay.json()).toMatchObject({ outcome: 'duplicate' })

      // A DIFFERENT event id for the same user converges to an update (no 409).
      const converge = await signedRequest(app, {
        id: 'e1b',
        type: 'user.created',
        platformUserId: 'p9',
        email: 'student@example.com',
        displayName: 'Student Renamed',
      })
      expect(await converge.json()).toMatchObject({ outcome: 'updated' })

      const upgraded = await signedRequest(app, {
        id: 'e2',
        type: 'tier.updated',
        platformUserId: 'p9',
        tier: 'pro',
        tierExpiresAt: null,
      })
      expect(await upgraded.json()).toMatchObject({ outcome: 'updated' })
      expect((await findAccountByPlatformUserId(db, 'p9'))?.tier).toBe('pro')

      const removed = await signedRequest(app, {
        id: 'e3',
        type: 'user.removed',
        platformUserId: 'p9',
      })
      expect(await removed.json()).toMatchObject({ outcome: 'removed' })
      expect((await findAccountByPlatformUserId(db, 'p9'))?.status).toBe('disabled')

      // Unknown user events are acknowledged but ignored (retry-safe).
      const ghost = await signedRequest(app, {
        id: 'e4',
        type: 'tier.updated',
        platformUserId: 'ghost',
        tier: 'pro',
      })
      expect(await ghost.json()).toMatchObject({ outcome: 'ignored' })
    })
  })
})
