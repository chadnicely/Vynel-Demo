// The updater HTTP surface through the real app (real onError mapping):
// newer → 200 with the exact Tauri body, up-to-date / unknown platform →
// bodyless 204, malformed path segments → the {code, message} 400 envelope.
// The DB is live (house harness) but this surface never touches it.

import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose'
import pino from 'pino'
import { describe, it, expect, beforeAll } from 'vitest'
import type { Hono } from 'hono'
import { withTestCloudDatabase } from '@vynel/cloud-db/testing'
import type { CloudDatabase } from '@vynel/cloud-db'
import type { DesktopReleaseManifest } from '@vynel/contracts/hub/desktop-release'
import {
  createAccessTokenIssuer,
  createAccessTokenVerifier,
  createEntitlementTokenIssuer,
  type AccessTokenIssuer,
  type AccessTokenVerifier,
  type EntitlementTokenIssuer,
} from '@vynel/accounts'
import { createInMemoryArtifactStore } from '@vynel/registry'
import { createCloudApp } from '../app.js'
import { createDesktopReleaseSource } from '../services/desktop-release-manifest.js'

const silentLogger = pino({ level: 'silent' })

const MANIFEST: DesktopReleaseManifest = {
  version: '0.2.0',
  pub_date: '2026-08-09T00:00:00.000Z',
  platforms: {
    'windows-x86_64': {
      signature: 'minisign-sig-content',
      url: 'https://github.com/kafijunior/vynel-releases/releases/download/v0.2.0/Vynel_0.2.0_x64-setup.exe',
    },
  },
}

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
    desktopReleases: createDesktopReleaseSource({
      manifestUrl: 'https://releases.test/latest.json',
      logger: silentLogger,
      fetchManifest: async () => MANIFEST,
    }),
    linkBaseUrl: 'https://hub.test',
    adminToken: 'test-admin-token-0123456789abcdef-0123456789abcdef',
  })
}

const check = (app: Hono, target: string, arch: string, version: string) =>
  app.request(`/releases/desktop/${target}/${arch}/${version}`)

describe('GET /releases/desktop/:target/:arch/:currentVersion', () => {
  it('answers 200 with the Tauri update body when an update exists', async () => {
    await withTestCloudDatabase(async (db) => {
      const app = buildApp(db)
      const res = await check(app, 'windows', 'x86_64', '0.1.0')
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        version: '0.2.0',
        pub_date: '2026-08-09T00:00:00.000Z',
        url: MANIFEST.platforms['windows-x86_64']?.url,
        signature: 'minisign-sig-content',
      })
    })
  })

  it('answers a bodyless 204 when the client is up to date or ahead', async () => {
    await withTestCloudDatabase(async (db) => {
      const app = buildApp(db)
      const upToDate = await check(app, 'windows', 'x86_64', '0.2.0')
      expect(upToDate.status).toBe(204)
      expect(await upToDate.text()).toBe('')
      expect((await check(app, 'windows', 'x86_64', '0.3.0')).status).toBe(204)
    })
  })

  it('answers 204 for a platform the manifest does not carry', async () => {
    await withTestCloudDatabase(async (db) => {
      const app = buildApp(db)
      expect((await check(app, 'linux', 'x86_64', '0.1.0')).status).toBe(204)
      expect((await check(app, 'darwin', 'aarch64', '0.1.0')).status).toBe(204)
    })
  })

  it('rejects malformed target, arch, and version as typed 400s', async () => {
    await withTestCloudDatabase(async (db) => {
      const app = buildApp(db)
      const badTarget = await check(app, 'winblows', 'x86_64', '0.1.0')
      expect(badTarget.status).toBe(400)
      expect(((await badTarget.json()) as { code: string }).code).toBe('validation_failed')

      expect((await check(app, 'windows', 'x64', '0.1.0')).status).toBe(400)
      expect((await check(app, 'windows', 'x86_64', '0.1')).status).toBe(400)
      expect((await check(app, 'windows', 'x86_64', 'v0.1.0')).status).toBe(400)
      expect((await check(app, 'windows', 'x86_64', '0.1.0-beta.1')).status).toBe(400)
    })
  })
})
