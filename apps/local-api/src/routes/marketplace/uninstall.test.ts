// POST /marketplace/uninstall dispatch, full HTTP stack over the product DB +
// real disk (temp workspace): a SKILL item hard-deletes its installed row (and
// on-disk folder), an AGENT item soft-deletes its `agents` row — and in both
// cases the item's card flips back to "Get" (install status re-derives from
// the same per-kind readers the annotator uses).

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
import { findAgentBySlug, insertAgent } from '@vynel/db/repositories/agents'
import { syncCloudCatalog } from '@vynel/marketplace'
import type { HubSession } from '@vynel/hub-account'
import type { HubCatalogItem } from '@vynel/contracts/hub/catalog'
import { createApp } from '../../app.js'

const silentLogger = pino({ level: 'silent' })
let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'vynel-mkt-uninstall-'))
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

function cloudAgentItem(sha: string): HubCatalogItem {
  return {
    itemId: 'focus-writer',
    kind: 'agent',
    publisherName: 'Vynel Team',
    publisherTier: 'verified',
    publisherUrl: null,
    sourceUrl: null,
    displayName: 'Focus Writer',
    oneLineDescription: 'x',
    category: 'notes',
    iconName: 'pen-line',
    recommendedScope: 'workspace',
    minimumTier: 'basic',
    latestVersion: '1.0.0',
    latestVersionManifestJson: '{"entry":"SKILL.md"}',
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

async function agentArtifactZip(): Promise<{ bytes: Buffer; sha: string }> {
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
  return { bytes, sha: createHash('sha256').update(bytes).digest('hex') }
}

async function installReq(app: ReturnType<typeof createApp>, wsId: string, itemId: string) {
  return app.request(`/workspaces/${wsId}/marketplace/install`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ itemId, scope: 'workspace' }),
  })
}

async function uninstallReq(app: ReturnType<typeof createApp>, wsId: string, itemId: string) {
  return app.request(`/workspaces/${wsId}/marketplace/uninstall`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ itemId }),
  })
}

async function itemStatus(app: ReturnType<typeof createApp>, wsId: string, itemId: string) {
  const res = await app.request(`/workspaces/${wsId}/marketplace/items/${itemId}`)
  expect(res.status).toBe(200)
  const item = (await res.json()) as { installStatus: { kind: string } }
  return item.installStatus.kind
}

describe('POST /marketplace/uninstall', () => {
  it('uninstalls an installed SKILL item and flips its card back to not-installed', async () => {
    await withTestDatabase(async (db) => {
      const { workspace } = seed(db)
      const app = createApp({ db, logger: silentLogger, hubSession: fakeHubSession({}) })

      const installRes = await installReq(app, workspace.id, 'email-drafter')
      expect(installRes.status).toBe(201)
      const { installedSkillId } = (await installRes.json()) as { installedSkillId: string }
      expect(await itemStatus(app, workspace.id, 'email-drafter')).toBe('installed')

      const res = await uninstallReq(app, workspace.id, 'email-drafter')
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        kind: 'skill',
        installedSkillId,
        itemId: 'email-drafter',
      })
      expect(await itemStatus(app, workspace.id, 'email-drafter')).toBe('not-installed')
    })
  })

  it('uninstalls an installed AGENT item (soft-delete) and flips its card back', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seed(db)
      const { bytes, sha } = await agentArtifactZip()
      syncCloudCatalog(db, [cloudAgentItem(sha)], new Date())
      const downloadArtifact = vi.fn().mockResolvedValue(bytes)
      const app = createApp({ db, logger: silentLogger, hubSession: fakeHubSession({ downloadArtifact }) })

      const installRes = await installReq(app, workspace.id, 'focus-writer')
      expect(installRes.status).toBe(201)
      const { agentId } = (await installRes.json()) as { agentId: string }
      expect(await itemStatus(app, workspace.id, 'focus-writer')).toBe('installed')

      const res = await uninstallReq(app, workspace.id, 'focus-writer')
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        kind: 'agent',
        agentId,
        itemId: 'focus-writer',
      })
      // The soft-deleted row is excluded by the deletedAt filter — the
      // annotator's injected reader no longer sees it, so the card flips.
      expect(await itemStatus(app, workspace.id, 'focus-writer')).toBe('not-installed')
      expect(
        findAgentBySlug(db, { userId: user.id, workspaceId: workspace.id, slug: 'focus-writer' }),
      ).toBeNull()
    })
  })

  it('answers 404 for a catalog item that is not installed', async () => {
    await withTestDatabase(async (db) => {
      const { workspace } = seed(db)
      const app = createApp({ db, logger: silentLogger, hubSession: fakeHubSession({}) })

      const res = await uninstallReq(app, workspace.id, 'email-drafter')
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({
        code: 'not_found',
        message: 'installed-item not found: email-drafter',
      })
    })
  })

  it('answers 404 for an unknown itemId (catalog miss)', async () => {
    await withTestDatabase(async (db) => {
      const { workspace } = seed(db)
      const app = createApp({ db, logger: silentLogger, hubSession: fakeHubSession({}) })

      const res = await uninstallReq(app, workspace.id, 'never-published')
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({
        code: 'not_found',
        message: 'marketplace-item not found: never-published',
      })
    })
  })

  it('never touches a HAND-MADE agent whose slug collides with a catalog itemId', async () => {
    await withTestDatabase(async (db) => {
      const { user, workspace } = seed(db)
      const { sha } = await agentArtifactZip()
      syncCloudCatalog(db, [cloudAgentItem(sha)], new Date())
      const app = createApp({ db, logger: silentLogger, hubSession: fakeHubSession({}) })

      // Built in the agent builder (`source: 'user'`), NOT installed from
      // the marketplace — its slug happens to equal the catalog itemId.
      const now = new Date()
      const handmade = insertAgent(db, {
        id: randomUUID(),
        userId: user.id,
        workspaceId: workspace.id,
        slug: 'focus-writer',
        name: 'My Focus Writer',
        description: 'Hand-made agent.',
        icon: null,
        prompt: 'You are my own focus writer.',
        model: null,
        effort: null,
        permissionMode: null,
        background: false,
        allowedTools: null,
        disallowedTools: null,
        scope: 'workspace',
        source: 'user',
        trustTier: 'community',
        enabled: true,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })

      // The card stays "Get" — the annotator matches community-sourced
      // agents only — and uninstall 404s instead of soft-deleting the row.
      expect(await itemStatus(app, workspace.id, 'focus-writer')).toBe('not-installed')

      const res = await uninstallReq(app, workspace.id, 'focus-writer')
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({
        code: 'not_found',
        message: 'installed-item not found: focus-writer',
      })
      expect(
        findAgentBySlug(db, { userId: user.id, workspaceId: workspace.id, slug: 'focus-writer' })
          ?.id,
      ).toBe(handmade.id)
    })
  })

  it('never crosses kinds: removing the agent leaves the skill installed, and vice versa', async () => {
    await withTestDatabase(async (db) => {
      const { workspace } = seed(db)
      const { bytes, sha } = await agentArtifactZip()
      syncCloudCatalog(db, [cloudAgentItem(sha)], new Date())
      const downloadArtifact = vi.fn().mockResolvedValue(bytes)
      const app = createApp({ db, logger: silentLogger, hubSession: fakeHubSession({ downloadArtifact }) })

      expect((await installReq(app, workspace.id, 'email-drafter')).status).toBe(201)
      expect((await installReq(app, workspace.id, 'focus-writer')).status).toBe(201)

      expect((await uninstallReq(app, workspace.id, 'focus-writer')).status).toBe(200)
      expect(await itemStatus(app, workspace.id, 'email-drafter')).toBe('installed')
      expect(await itemStatus(app, workspace.id, 'focus-writer')).toBe('not-installed')

      expect((await uninstallReq(app, workspace.id, 'email-drafter')).status).toBe(200)
      expect(await itemStatus(app, workspace.id, 'email-drafter')).toBe('not-installed')
    })
  })
})
