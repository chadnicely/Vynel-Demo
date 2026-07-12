// POST /marketplace/install dispatch, full HTTP stack over the product DB +
// real disk (temp workspace): a CACHED cloud item downloads its verified
// artifact and installs as 'marketplace'; a BUNDLED item (email-drafter)
// installs from its in-code template as 'verified-catalog'; a cloud AGENT
// item (C-agents) installs as a community `agents` row.

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
import { findAgentBySlug } from '@vynel/db/repositories/agents'
import { listInstalledSkillsForUserAndWorkspace } from '@vynel/skills'
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

function cloudCatalogItem(sha: string, over: Partial<HubCatalogItem> = {}): HubCatalogItem {
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
    ...over,
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
      expect(await res.json()).toMatchObject({
        kind: 'skill',
        itemId: 'cloud-skill',
        source: 'marketplace',
        version: '2.0.0',
      })
      expect(downloadArtifact).toHaveBeenCalledWith('cloud-skill', '2.0.0')
    })
  })

  it('installs a BUNDLED item from its template', async () => {
    await withTestDatabase(async (db) => {
      const { workspace } = seed(db)
      const app = createApp({ db, logger: silentLogger, hubSession: fakeHubSession({}) })
      const res = await installReq(app, workspace.id, 'email-drafter')
      expect(res.status).toBe(201)
      expect(await res.json()).toMatchObject({
        kind: 'skill',
        itemId: 'email-drafter',
        source: 'verified-catalog',
      })
    })
  })

  it('installs a cloud AGENT item as a community agents row (C-agents)', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seed(db)
      const zip = new JSZip()
      zip.file(
        'agent.json',
        JSON.stringify({
          slug: 'focus-writer',
          name: 'Focus Writer',
          description: 'Turns rough notes into polished prose.',
          prompt: 'You are a focused writing assistant.',
          icon: 'pen-line',
        }),
      )
      const bytes = await zip.generateAsync({ type: 'nodebuffer' })
      const sha = createHash('sha256').update(bytes).digest('hex')
      syncCloudCatalog(
        db,
        [cloudCatalogItem(sha, { itemId: 'focus-writer', kind: 'agent', displayName: 'Focus Writer' })],
        new Date(),
      )

      const downloadArtifact = vi.fn().mockResolvedValue(bytes)
      const app = createApp({ db, logger: silentLogger, hubSession: fakeHubSession({ downloadArtifact }) })

      const res = await installReq(app, workspace.id, 'focus-writer')
      expect(res.status).toBe(201)
      expect(await res.json()).toMatchObject({
        kind: 'agent',
        slug: 'focus-writer',
        itemId: 'focus-writer',
        scope: 'workspace',
        version: '2.0.0',
      })
      expect(downloadArtifact).toHaveBeenCalledWith('focus-writer', '2.0.0')
      const agent = findAgentBySlug(db, {
        userId: user.id,
        workspaceId: workspace.id,
        slug: 'focus-writer',
      })
      expect(agent).toMatchObject({ source: 'community', trustTier: 'community', enabled: true })
    })
  })

  it('treats a cached NON-INSTALLABLE kind (mcp) as not-cloud — indistinguishable from an unknown id', async () => {
    await withTestDatabase(async (db) => {
      const { workspace } = seed(db)
      syncCloudCatalog(
        db,
        [cloudCatalogItem('a'.repeat(64), { itemId: 'some-mcp', kind: 'mcp' })],
        new Date(),
      )
      const app = createApp({ db, logger: silentLogger, hubSession: fakeHubSession({}) })

      // Falls through to the bundled dispatch; with no bundled twin the
      // not-found is byte-identical (same entity + message shape) to a
      // truly unknown id — no enumeration distinguisher.
      const cachedRes = await installReq(app, workspace.id, 'some-mcp')
      const unknownRes = await installReq(app, workspace.id, 'never-published')
      expect(cachedRes.status).toBe(404)
      expect(unknownRes.status).toBe(404)
      // test: correct expectation — the shared surface gate now answers BEFORE the
      // skill dispatch, so the 404 entity is 'marketplace-item' (uniform with
      // uninstall + the global surface); the guarded property (cached-mcp ≡
      // unknown id) is unchanged.
      expect(await cachedRes.json()).toEqual({ code: 'not_found', message: 'marketplace-item not found: some-mcp' })
      expect(await unknownRes.json()).toEqual({
        code: 'not_found',
        message: 'marketplace-item not found: never-published',
      })
    })
  })

  it('404s a cached USER-only item on the workspace surface — indistinguishable from an unknown id, no row lands', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seed(db)
      syncCloudCatalog(
        db,
        [cloudCatalogItem('a'.repeat(64), { itemId: 'user-only-skill', recommendedScope: 'user' })],
        new Date(),
      )
      const downloadArtifact = vi.fn()
      const app = createApp({ db, logger: silentLogger, hubSession: fakeHubSession({ downloadArtifact }) })

      const offSurfaceRes = await installReq(app, workspace.id, 'user-only-skill')
      const unknownRes = await installReq(app, workspace.id, 'never-published')
      expect(offSurfaceRes.status).toBe(404)
      expect(unknownRes.status).toBe(404)
      const offSurfaceBody = (await offSurfaceRes.json()) as { code: string; message: string }
      const unknownBody = (await unknownRes.json()) as { code: string; message: string }
      expect(offSurfaceBody.code).toBe('not_found')
      // No enumeration distinguisher: modulo the id, the off-surface 404
      // is byte-identical to the unknown-id one.
      expect(offSurfaceBody.message.replace('user-only-skill', '<id>')).toBe(
        unknownBody.message.replace('never-published', '<id>'),
      )
      // Nothing downloaded, and no row landed at ANY scope — a row here
      // would be uninstallable from every surface.
      expect(downloadArtifact).not.toHaveBeenCalled()
      expect(
        listInstalledSkillsForUserAndWorkspace(db, { userId: user.id, workspaceId: workspace.id }),
      ).toHaveLength(0)
      expect(
        listInstalledSkillsForUserAndWorkspace(db, { userId: user.id, workspaceId: null }),
      ).toHaveLength(0)
    })
  })

  it('never lets a cached NON-INSTALLABLE row shadow a same-id bundled skill', async () => {
    await withTestDatabase(async (db) => {
      const { workspace } = seed(db)
      syncCloudCatalog(
        db,
        [cloudCatalogItem('a'.repeat(64), { itemId: 'email-drafter', kind: 'mcp' })],
        new Date(),
      )
      const app = createApp({ db, logger: silentLogger, hubSession: fakeHubSession({}) })
      const res = await installReq(app, workspace.id, 'email-drafter')
      expect(res.status).toBe(201)
      expect(await res.json()).toMatchObject({
        kind: 'skill',
        itemId: 'email-drafter',
        source: 'verified-catalog',
      })
    })
  })
})
