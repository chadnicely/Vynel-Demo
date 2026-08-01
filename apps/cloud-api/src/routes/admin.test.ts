// The admin surface end-to-end over PGlite: the DUAL DOOR (static token OR a
// FRESH-read admin-role account — a member is refused, a demoted admin loses
// the surface on the next request) and the catalog lifecycle (list-all incl.
// drafts → edit metadata → yank kills browse AND download instantly).

import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose'
import pino from 'pino'
import { describe, it, expect, beforeAll } from 'vitest'
import type { Hono } from 'hono'
import { withTestCloudDatabase } from '@vynel/cloud-db/testing'
import type { CloudDatabase } from '@vynel/cloud-db'
import { insertAccount, setAccountRole } from '@vynel/cloud-db/repositories/accounts'
import type { HubAdminAccount } from '@vynel/contracts/hub/admin'
import {
  createAccessTokenIssuer,
  createAccessTokenVerifier,
  createEntitlementTokenIssuer,
  type AccessTokenIssuer,
  type AccessTokenVerifier,
  type EntitlementTokenIssuer,
} from '@vynel/accounts'
import { createInMemoryArtifactStore } from '@vynel/registry'
import type { HubAdminCatalogItem } from '@vynel/contracts/hub/admin'
import { createCloudApp } from '../app.js'

const ADMIN = 'test-admin-token-0123456789abcdef-0123456789abcdef'
const silentLogger = pino({ level: 'silent' })
const ARTIFACT = Buffer.from('PK fake zip bytes')

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
    linkBaseUrl: 'https://hub.test',
    adminToken: ADMIN,
  })
}

/** Seed an account and mint a real access token for it. */
async function seedAccount(db: CloudDatabase, id: string): Promise<string> {
  await insertAccount(db, { id, email: `${id}@ex.com`, displayName: id })
  const { token } = await accessTokens.issue({
    accountId: id,
    email: `${id}@ex.com`,
    displayName: id,
  })
  return token
}

function publishBody(itemId: string, status: 'draft' | 'published' = 'published') {
  return {
    publisher: { id: 'vynel-team', name: 'Vynel Team', tier: 'verified', url: null },
    item: {
      itemId,
      kind: 'skill',
      displayName: itemId,
      oneLineDescription: 'x',
      category: 'email',
      iconName: 'mail',
      recommendedScope: 'user',
      minimumTier: 'basic',
      status,
    },
    version: { version: '1.0.0', changelog: '', manifest: { entry: 'SKILL.md' } },
    artifactBase64: ARTIFACT.toString('base64'),
  }
}

const jsonInit = (token: string, body: unknown, method = 'POST') => ({
  method,
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify(body),
})
const auth = (token: string) => ({ headers: { authorization: `Bearer ${token}` } })

describe('admin routes — the dual door', () => {
  it('member 403s, admin passes, a demoted admin loses the surface FRESH', async () => {
    await withTestCloudDatabase(async (db) => {
      const app = buildApp(db)
      const memberToken = await seedAccount(db, 'plain-member')
      const adminToken = await seedAccount(db, 'real-admin')
      await setAccountRole(db, { accountId: 'real-admin', role: 'admin' })

      expect((await app.request('/admin/catalog')).status).toBe(401) // no bearer at all
      expect((await app.request('/admin/catalog', auth(memberToken))).status).toBe(403)
      expect((await app.request('/admin/catalog', auth(adminToken))).status).toBe(200)
      expect((await app.request('/admin/catalog', auth(ADMIN))).status).toBe(200) // static door

      // Demotion bites on the very next request — the role is never token-carried.
      await setAccountRole(db, { accountId: 'real-admin', role: 'member' })
      expect((await app.request('/admin/catalog', auth(adminToken))).status).toBe(403)
    })
  })

  it('grants a role via the static door (the bootstrap path); unknown account 404s', async () => {
    await withTestCloudDatabase(async (db) => {
      const app = buildApp(db)
      const userToken = await seedAccount(db, 'future-admin')

      expect((await app.request('/admin/catalog', auth(userToken))).status).toBe(403)
      // The exact threat this route exists to prevent: a member may NOT grant
      // themselves admin — the middleware refuses before route logic runs.
      expect(
        (await app.request('/admin/accounts/future-admin/role', jsonInit(userToken, { role: 'admin' }))).status,
      ).toBe(403)
      const grant = await app.request(
        '/admin/accounts/future-admin/role',
        jsonInit(ADMIN, { role: 'admin' }),
      )
      expect(grant.status).toBe(200)
      expect((await app.request('/admin/catalog', auth(userToken))).status).toBe(200)

      expect(
        (await app.request('/admin/accounts/ghost/role', jsonInit(ADMIN, { role: 'admin' }))).status,
      ).toBe(404)
    })
  })
})

describe('admin routes — account management', () => {
  it('lists accounts as the allowlisted DTO — no passwordHash, no platform internals', async () => {
    await withTestCloudDatabase(async (db) => {
      const app = buildApp(db)
      await insertAccount(db, {
        id: 'acct-1',
        email: 'One@Ex.com',
        displayName: 'One',
        platformUserId: 'plat-1',
        passwordHash: 'super-secret-hash',
      })

      const response = await app.request('/admin/accounts', auth(ADMIN))
      expect(response.status).toBe(200)
      const raw = await response.text()
      expect(raw).not.toContain('passwordHash')
      expect(raw).not.toContain('super-secret-hash')
      expect(raw).not.toContain('platformUserId')

      const { accounts } = JSON.parse(raw) as { accounts: HubAdminAccount[] }
      expect(accounts).toHaveLength(1)
      expect(accounts[0]).toMatchObject({
        id: 'acct-1',
        email: 'one@ex.com',
        displayName: 'One',
        role: 'member',
        tier: 'basic',
        tierExpiresAt: null,
        status: 'active',
      })
    })
  })

  it('changes tier (with optional expiry) and 404s an unknown account', async () => {
    await withTestCloudDatabase(async (db) => {
      const app = buildApp(db)
      await insertAccount(db, { id: 'tier-me', email: 'tier@ex.com', displayName: 'Tier' })

      const upgrade = await app.request(
        '/admin/accounts/tier-me/tier',
        jsonInit(ADMIN, { tier: 'pro', tierExpiresAt: '2027-01-01T00:00:00.000Z' }),
      )
      expect(upgrade.status).toBe(200)

      const list = await app.request('/admin/accounts', auth(ADMIN))
      const { accounts } = (await list.json()) as { accounts: HubAdminAccount[] }
      expect(accounts[0]).toMatchObject({
        tier: 'pro',
        tierExpiresAt: '2027-01-01T00:00:00.000Z',
      })

      expect(
        (await app.request('/admin/accounts/ghost/tier', jsonInit(ADMIN, { tier: 'pro' }))).status,
      ).toBe(404)
    })
  })

  it('disabling an admin kills their surface on the very next request', async () => {
    await withTestCloudDatabase(async (db) => {
      const app = buildApp(db)
      const adminToken = await seedAccount(db, 'soon-gone')
      await setAccountRole(db, { accountId: 'soon-gone', role: 'admin' })
      expect((await app.request('/admin/catalog', auth(adminToken))).status).toBe(200)

      const disable = await app.request(
        '/admin/accounts/soon-gone/status',
        jsonInit(ADMIN, { status: 'disabled' }),
      )
      expect(disable.status).toBe(200)
      // The fresh-read rule: the still-valid JWT no longer carries authority.
      expect((await app.request('/admin/catalog', auth(adminToken))).status).toBe(403)

      const list = await app.request('/admin/accounts', auth(ADMIN))
      const { accounts } = (await list.json()) as { accounts: HubAdminAccount[] }
      expect(accounts.find((a) => a.id === 'soon-gone')?.status).toBe('disabled')

      // Re-enable restores the surface — the lifecycle is reversible.
      await app.request('/admin/accounts/soon-gone/status', jsonInit(ADMIN, { status: 'active' }))
      expect((await app.request('/admin/catalog', auth(adminToken))).status).toBe(200)

      expect(
        (await app.request('/admin/accounts/ghost/status', jsonInit(ADMIN, { status: 'disabled' }))).status,
      ).toBe(404)
    })
  })
})

describe('admin routes — validation envelope', () => {
  it('answers a schema-invalid publish with the {code, message} 400 envelope', async () => {
    await withTestCloudDatabase(async (db) => {
      const app = buildApp(db)
      const body = publishBody('bad-version-skill')
      body.version.version = 'not-a-semver'
      const response = await app.request('/admin/catalog/publish', jsonInit(ADMIN, body))
      expect(response.status).toBe(400)
      // The exact regression this guards: bare zValidator used to answer raw
      // zod output here, breaking the hub-wide error envelope.
      const errorBody = (await response.json()) as { code: string; message: string }
      expect(errorBody.code).toBe('validation_failed')
      expect(errorBody.message).toContain('version.version')
    })
  })
})

describe('admin routes — the catalog lifecycle', () => {
  it('lists ALL statuses with versions, edits metadata, and yank kills browse + download', async () => {
    await withTestCloudDatabase(async (db) => {
      const app = buildApp(db)
      const publish = (body: unknown) =>
        app.request('/admin/catalog/publish', jsonInit(ADMIN, body))
      expect((await publish(publishBody('live-skill'))).status).toBe(201)
      expect((await publish(publishBody('draft-skill', 'draft'))).status).toBe(201)

      // The admin list carries the DRAFT the public browse hides, with versions.
      const list = await app.request('/admin/catalog', auth(ADMIN))
      const { items } = (await list.json()) as { items: HubAdminCatalogItem[] }
      expect(items.map((i) => i.itemId).sort()).toEqual(['draft-skill', 'live-skill'])
      expect(items.find((i) => i.itemId === 'draft-skill')?.status).toBe('draft')
      expect(items.find((i) => i.itemId === 'live-skill')?.versions).toHaveLength(1)

      // Metadata patch lands; an empty patch is refused; a ghost item 404s.
      expect(
        (await app.request('/admin/catalog/live-skill', jsonInit(ADMIN, { displayName: 'Live!' }, 'PATCH'))).status,
      ).toBe(200)
      expect((await app.request('/admin/catalog/live-skill', jsonInit(ADMIN, {}, 'PATCH'))).status).toBe(400)
      // Publish allows 280-char descriptions — the PATCH cap must round-trip them.
      expect(
        (
          await app.request(
            '/admin/catalog/live-skill',
            jsonInit(ADMIN, { oneLineDescription: 'd'.repeat(250) }, 'PATCH'),
          )
        ).status,
      ).toBe(200)
      expect(
        (await app.request('/admin/catalog/ghost', jsonInit(ADMIN, { displayName: 'X' }, 'PATCH'))).status,
      ).toBe(404)

      // An item can recommend BOTH scopes — 'both' round-trips patch → list.
      expect(
        (
          await app.request(
            '/admin/catalog/live-skill',
            jsonInit(ADMIN, { recommendedScope: 'both' }, 'PATCH'),
          )
        ).status,
      ).toBe(200)
      const relisted = await app.request('/admin/catalog', auth(ADMIN))
      const bothItems = (await relisted.json()) as { items: HubAdminCatalogItem[] }
      expect(bothItems.items.find((i) => i.itemId === 'live-skill')?.recommendedScope).toBe('both')

      // Yank: browse loses the item AND the download gate refuses it, instantly.
      const userToken = await seedAccount(db, 'shopper')
      expect(
        (await app.request('/admin/catalog/live-skill/status', jsonInit(ADMIN, { status: 'yanked' }))).status,
      ).toBe(200)
      const browse = await app.request('/catalog', auth(userToken))
      const browsed = (await browse.json()) as { items: Array<{ itemId: string }> }
      expect(browsed.items.find((i) => i.itemId === 'live-skill')).toBeUndefined()
      expect(
        (await app.request('/catalog/live-skill/versions/1.0.0/download', auth(userToken))).status,
      ).toBe(404)

      // Un-yank restores distribution — soft lifecycle is reversible.
      await app.request('/admin/catalog/live-skill/status', jsonInit(ADMIN, { status: 'published' }))
      expect(
        (await app.request('/catalog/live-skill/versions/1.0.0/download', auth(userToken))).status,
      ).toBe(200)
    })
  })
})

describe('admin routes — upstream watch', () => {
  it('answers configured:false without the job, and serves the stub state with it', async () => {
    await withTestCloudDatabase(async (db) => {
      const bare = buildApp(db)
      const off = await bare.request('/admin/upstream-watch', {
        headers: { authorization: `Bearer ${ADMIN}` },
      })
      expect(await off.json()).toEqual({ configured: false })

      const report = {
        checkedAt: '2026-08-02T09:00:00.000Z',
        repo: 'anthropics/skills',
        pinnedSha: 'a'.repeat(40),
        upstreamHeadSha: 'b'.repeat(40),
        upToDate: false,
        movedCount: 1,
        items: [{ itemId: 'canvas-design', version: '1.0.0', changed: true, changedFiles: ['skills/canvas-design/SKILL.md'] }],
        repinRecipe: 're-pin recipe',
      }
      const state = { report, lastError: null, lastRunAt: report.checkedAt }
      const withJob = createCloudApp({
        db,
        logger: silentLogger,
        accessTokens,
        accessTokenVerifier,
        entitlements,
        mail: { sendSetPasswordLink: async () => {} },
        artifactStore: createInMemoryArtifactStore(),
        linkBaseUrl: 'https://hub.test',
        adminToken: ADMIN,
        upstreamWatch: { state: () => state, runNow: async () => state, stop: () => {} },
      })

      const res = await withJob.request('/admin/upstream-watch', {
        headers: { authorization: `Bearer ${ADMIN}` },
      })
      expect(await res.json()).toEqual({ configured: true, ...state })

      const check = await withJob.request('/admin/upstream-watch/check', {
        method: 'POST',
        headers: { authorization: `Bearer ${ADMIN}` },
      })
      expect(await check.json()).toEqual({ configured: true, ...state })

      // The dual door still guards the new surface.
      expect((await withJob.request('/admin/upstream-watch')).status).toBe(401)
    })
  })
})
