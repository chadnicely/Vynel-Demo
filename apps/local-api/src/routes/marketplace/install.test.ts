// POST /marketplace/install dispatch, full HTTP stack over the product DB +
// real disk (temp workspace): a CACHED cloud item downloads its verified
// artifact and installs as 'marketplace'; a BUNDLED item (email-drafter)
// installs from its in-code template as 'verified-catalog'.

import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import pino from 'pino'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { syncCloudCatalog } from '@vynel/marketplace'
import type { HubSession } from '@vynel/hub-account'
import type { HubCatalogItem } from '@vynel/contracts/hub/catalog'
import { createApp } from '../../app.js'

const silentLogger = pino({ level: 'silent' })
let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'vynel-mkt-install-'))
})
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

function fakeHubSession(over: Partial<HubSession>): HubSession {
  return {
    getStatus: vi.fn().mockReturnValue({ kind: 'signed-in' }),
    getEntitlement: vi.fn().mockReturnValue(null), // null → feature-gate permissive
    signIn: vi.fn(),
    signOut: vi.fn(),
    restore: vi.fn(),
    listDevices: vi.fn(),
    revokeDevice: vi.fn(),
    fetchCatalog: vi.fn(),
    downloadArtifact: vi.fn(),
    ...over,
  }
}

function cloudCatalogItem(sha: string): HubCatalogItem {
  return {
    itemId: 'cloud-skill',
    kind: 'skill',
    publisherName: 'Vynel Team',
    publisherTier: 'verified',
    publisherUrl: null,
    displayName: 'Cloud Skill',
    oneLineDescription: 'x',
    category: 'email',
    iconName: 'mail',
    recommendedScope: 'workspace',
    minimumTier: 'basic',
    latestVersion: '2.0.0',
    latestVersionSha256: sha,
    releasedAt: '2026-07-10T00:00:00.000Z',
    canInstall: true,
  }
}

function seed(db: Parameters<Parameters<typeof withTestDatabase>[0]>[0]) {
  const now = new Date()
  const user = insertUser(db, {
    id: randomUUID(), displayName: 'T', emailAddress: null, locale: 'en-US', timezone: 'UTC',
    hasCompletedOnboarding: true, createdAt: now, updatedAt: now,
  })
  const workspace = insertWorkspace(db, {
    id: randomUUID(), userId: user.id, name: 'Acme', kind: 'small-business', path: tmp,
    isArchived: false, createdAt: now, updatedAt: now, lastAccessedAt: now,
  })
  return { user, workspace }
}

async function installReq(app: ReturnType<typeof createApp>, wsId: string, itemId: string) {
  return app.request(`/workspaces/${wsId}/marketplace/install`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ itemId, scope: 'workspace' }),
  })
}

describe('POST /marketplace/install', () => {
  it('installs a CACHED cloud item from its verified artifact', async () => {
    await withTestDatabase(async (db) => {
      const { workspace } = seed(db)
      const zip = new JSZip()
      zip.file('SKILL.md', '# Cloud Skill\nbody')
      const bytes = await zip.generateAsync({ type: 'nodebuffer' })
      const sha = createHash('sha256').update(bytes).digest('hex')
      syncCloudCatalog(db, [cloudCatalogItem(sha)], new Date())

      const downloadArtifact = vi.fn().mockResolvedValue(bytes)
      const app = createApp({ db, logger: silentLogger, hubSession: fakeHubSession({ downloadArtifact }) })

      const res = await installReq(app, workspace.id, 'cloud-skill')
      expect(res.status).toBe(201)
      expect(await res.json()).toMatchObject({ itemId: 'cloud-skill', source: 'marketplace', version: '2.0.0' })
      expect(downloadArtifact).toHaveBeenCalledWith('cloud-skill', '2.0.0')
    })
  })

  it('installs a BUNDLED item from its template', async () => {
    await withTestDatabase(async (db) => {
      const { workspace } = seed(db)
      const app = createApp({ db, logger: silentLogger, hubSession: fakeHubSession({}) })
      const res = await installReq(app, workspace.id, 'email-drafter')
      expect(res.status).toBe(201)
      expect(await res.json()).toMatchObject({ itemId: 'email-drafter', source: 'verified-catalog' })
    })
  })
})
