// The catalog HTTP surface end-to-end over PGlite + in-memory artifact store:
// admin publish → browse (tier-annotated) → detail → download. The download
// gate is the security core — proven fail-CLOSED against the FRESH DB tier,
// not the token: a basic account is denied a pro item, a downgraded account
// loses access even holding a still-valid access token.

import { createHash } from 'node:crypto'
import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose'
import pino from 'pino'
import { describe, it, expect, beforeAll } from 'vitest'
import type { Hono } from 'hono'
import { withTestCloudDatabase } from '@vynel/cloud-db/testing'
import type { CloudDatabase } from '@vynel/cloud-db'
import { insertAccount, setAccountTier } from '@vynel/cloud-db/repositories/accounts'
import {
  createAccessTokenIssuer,
  createAccessTokenVerifier,
  createEntitlementTokenIssuer,
  type AccessTokenIssuer,
  type AccessTokenVerifier,
  type EntitlementTokenIssuer,
} from '@vynel/accounts'
import { createCloudApp } from '../app.js'
import { createInMemoryArtifactStore } from '@vynel/registry'
import { zipArtifact } from '@vynel/registry/testing'

const ADMIN = 'test-admin-token-0123456789abcdef-0123456789abcdef'
const silentLogger = pino({ level: 'silent' })
// Publish inspects every artifact now — the fixture must be a real zip.
const ARTIFACT = await zipArtifact({ 'SKILL.md': 'catalog route test artifact' })
const ARTIFACT_SHA = createHash('sha256').update(ARTIFACT).digest('hex')

let accessTokens: AccessTokenIssuer
let accessTokenVerifier: AccessTokenVerifier
let entitlements: EntitlementTokenIssuer

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair('EdDSA', { extractable: true })
  accessTokens = await createAccessTokenIssuer({ privateKeyPem: await exportPKCS8(privateKey), ttlSeconds: 3600 })
  accessTokenVerifier = await createAccessTokenVerifier({ publicKeyPem: await exportSPKI(publicKey) })
  entitlements = await createEntitlementTokenIssuer({ privateKeyPem: await exportPKCS8(privateKey), keyId: 'k' })
})

function buildApp(db: CloudDatabase): Hono {
  return createCloudApp({
    db,
    logger: silentLogger,
    accessTokens,
    accessTokenVerifier,
    entitlements,
    mail: { sendSetPasswordLink: async () => {} },
    artifactStore: createInMemoryArtifactStore(),
    desktopReleases: { resolveUpdate: async () => null },
    linkBaseUrl: 'https://hub.test',
    adminToken: ADMIN,
  })
}

/** Seed an account at a tier and mint a real access token for it. */
async function seedAccount(
  db: CloudDatabase,
  input: { id: string; tier: 'basic' | 'pro' },
): Promise<string> {
  await insertAccount(db, { id: input.id, email: `${input.id}@ex.com`, displayName: input.id })
  if (input.tier === 'pro') await setAccountTier(db, { accountId: input.id, tier: 'pro', tierExpiresAt: null })
  const { token } = await accessTokens.issue({
    accountId: input.id,
    email: `${input.id}@ex.com`,
    displayName: input.id,
  })
  return token
}

function publishBody(over: { itemId: string; minimumTier: 'basic' | 'pro' }) {
  return {
    publisher: { id: 'vynel-team', name: 'Vynel Team', tier: 'verified', url: null },
    item: {
      itemId: over.itemId,
      kind: 'skill',
      displayName: over.itemId,
      oneLineDescription: 'x',
      category: 'email',
      iconName: 'mail',
      recommendedScope: 'user',
      minimumTier: over.minimumTier,
      status: 'published',
    },
    version: { version: '1.0.0', changelog: '', manifest: { entry: 'SKILL.md' } },
    artifactBase64: ARTIFACT.toString('base64'),
  }
}

async function publish(app: Hono, over: { itemId: string; minimumTier: 'basic' | 'pro' }) {
  return app.request('/admin/catalog/publish', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${ADMIN}` },
    body: JSON.stringify(publishBody(over)),
  })
}

const auth = (token: string) => ({ headers: { authorization: `Bearer ${token}` } })

describe('catalog routes', () => {
  it('publishes, then browses with per-caller canInstall', async () => {
    await withTestCloudDatabase(async (db) => {
      const app = buildApp(db)
      expect((await publish(app, { itemId: 'free-skill', minimumTier: 'basic' })).status).toBe(201)
      expect((await publish(app, { itemId: 'pro-skill', minimumTier: 'pro' })).status).toBe(201)

      const basicToken = await seedAccount(db, { id: 'basic-user', tier: 'basic' })
      const res = await app.request('/catalog', auth(basicToken))
      const { items } = (await res.json()) as { items: Array<{ itemId: string; canInstall: boolean }> }
      expect(items.find((i) => i.itemId === 'free-skill')?.canInstall).toBe(true)
      expect(items.find((i) => i.itemId === 'pro-skill')?.canInstall).toBe(false)

      // Browse requires a token.
      expect((await app.request('/catalog')).status).toBe(401)
    })
  })

  it('gates download on the FRESH tier, fail-closed', async () => {
    await withTestCloudDatabase(async (db) => {
      const app = buildApp(db)
      await publish(app, { itemId: 'pro-skill', minimumTier: 'pro' })
      await publish(app, { itemId: 'free-skill', minimumTier: 'basic' })

      const basicToken = await seedAccount(db, { id: 'basic-user', tier: 'basic' })
      const proToken = await seedAccount(db, { id: 'pro-user', tier: 'pro' })
      const dl = (item: string, token: string) =>
        app.request(`/catalog/${item}/versions/1.0.0/download`, auth(token))

      // Basic denied the pro item; allowed the free one.
      expect((await dl('pro-skill', basicToken)).status).toBe(403)
      const free = await dl('free-skill', basicToken)
      expect(free.status).toBe(200)
      expect(free.headers.get('x-artifact-sha256')).toBe(ARTIFACT_SHA)
      expect(Buffer.from(await free.arrayBuffer()).equals(ARTIFACT)).toBe(true)

      // Pro gets the pro item.
      expect((await dl('pro-skill', proToken)).status).toBe(200)

      // The staleness defense: pro user holding a valid token is DOWNGRADED in
      // the DB → the next download is denied (never trusts the token's tier).
      await setAccountTier(db, { accountId: 'pro-user', tier: 'basic', tierExpiresAt: null })
      expect((await dl('pro-skill', proToken)).status).toBe(403)

      // 304 when the desktop already holds the version's bytes (sha ETag).
      const cached = await app.request('/catalog/free-skill/versions/1.0.0/download', {
        headers: { authorization: `Bearer ${basicToken}`, 'if-none-match': `"${ARTIFACT_SHA}"` },
      })
      expect(cached.status).toBe(304)
    })
  })

  it('a rejected republish does NOT overwrite the stored artifact bytes', async () => {
    await withTestCloudDatabase(async (db) => {
      const app = buildApp(db)
      expect((await publish(app, { itemId: 'free-skill', minimumTier: 'basic' })).status).toBe(201)

      // Republish the same version with DIFFERENT bytes → 409, bytes untouched.
      const tampered = { ...publishBody({ itemId: 'free-skill', minimumTier: 'basic' }), artifactBase64: (await zipArtifact({ 'SKILL.md': 'different bytes' })).toString('base64') }
      const conflict = await app.request('/admin/catalog/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${ADMIN}` },
        body: JSON.stringify(tampered),
      })
      expect(conflict.status).toBe(409)

      // The download still serves the ORIGINAL bytes matching the recorded sha.
      const token = await seedAccount(db, { id: 'u', tier: 'basic' })
      const dl = await app.request('/catalog/free-skill/versions/1.0.0/download', auth(token))
      expect(dl.headers.get('x-artifact-sha256')).toBe(ARTIFACT_SHA)
      expect(Buffer.from(await dl.arrayBuffer()).equals(ARTIFACT)).toBe(true)
    })
  })

  it('404s an unknown item and unknown version', async () => {
    await withTestCloudDatabase(async (db) => {
      const app = buildApp(db)
      await publish(app, { itemId: 'free-skill', minimumTier: 'basic' })
      const token = await seedAccount(db, { id: 'u', tier: 'basic' })
      expect((await app.request('/catalog/ghost/versions/1.0.0/download', auth(token))).status).toBe(404)
      expect((await app.request('/catalog/free-skill/versions/9.9.9/download', auth(token))).status).toBe(404)
    })
  })
})
