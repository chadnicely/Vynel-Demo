// Integration tests for the `/workspaces/:workspaceId/marketplace/...`
// routes. Full HTTP stack (route → workspaceScoped → core op →
// injected skills reader → repo → SQLite).
//
// The install-status assertion drives a REAL install through the
// mounted skills route (`POST /skills/install`) so a real
// `installed_skills` row exists — the end-to-end join marketplace
// exists to surface. That install writes under `~/.claude/skills/`, so
// it runs inside `withHomeDir` (from `@vynel/skills/test-support`) to
// redirect the host home dir to a per-test tmpdir. The not-installed /
// category / 404 cases need no install and run on `seedWorld` alone.
//
// Spec: blueprint §13.3 + coding.md §6.4.

import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { withTestDatabase } from '@vynel/testing'
import { insertUser } from '@vynel/db/repositories/users'
import { insertWorkspace } from '@vynel/db/repositories/workspaces'
import { withHomeDir } from '@vynel/skills/test-support'
import { createApp } from '../../app.js'

const silentLogger = pino({ level: 'silent' })

// Hermetic plugin registry: the injectable reader seam keeps the list
// annotator off this machine's real ~/.claude/plugins.
const noInstalledPlugins = () => []

function seedWorld(
  db: Parameters<Parameters<typeof withTestDatabase>[0]>[0],
  workspacePath = '/fake/workspace/path',
) {
  const now = new Date()
  const user = insertUser(db, {
    id: randomUUID(),
    displayName: 'T',
    emailAddress: null,
    locale: 'en-US',
    timezone: 'UTC',
    hasCompletedOnboarding: false,
    createdAt: now,
    updatedAt: now,
  })
  const workspace = insertWorkspace(db, {
    id: randomUUID(),
    userId: user.id,
    name: 'Acme',
    kind: 'small-business',
    path: workspacePath,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
  })
  return { user, workspace }
}

// Isolate BOTH the workspace dir and the host home dir to per-test
// tmpdirs so driving a user-scope install never touches the dev's real
// `~/.claude/skills/`. Mirrors `withIsolatedFs` in the skills route test.
async function withIsolatedFs<T>(fn: (workspacePath: string) => Promise<T>): Promise<T> {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'vynel-marketplace-routes-test-'))
  const homeDir = mkdtempSync(join(tmpdir(), 'vynel-marketplace-home-'))
  try {
    return await withHomeDir(homeDir, () => fn(workspaceDir))
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true })
    rmSync(homeDir, { recursive: true, force: true })
  }
}

describe('marketplace routes', () => {
  describe('GET /workspaces/:workspaceId/marketplace/items', () => {
    it('returns 200 with 1 annotated item for a fresh workspace', async () => {
      await withTestDatabase(async (db) => {
        const { workspace } = seedWorld(db)
        const app = createApp({ db, logger: silentLogger, claudeMarketplacesReader: () => [], marketplaceInstalledPluginsReader: noInstalledPlugins })
        const res = await app.request(`/workspaces/${workspace.id}/marketplace/items`)
        expect(res.status).toBe(200)
        const body = (await res.json()) as Array<{
          itemId: string
          publisherTier: string
          installStatus: { kind: string }
        }>
        expect(body).toHaveLength(1)
        expect(body[0]?.itemId).toBe('email-drafter')
        expect(body[0]?.publisherTier).toBe('verified')
        expect(body[0]?.installStatus.kind).toBe('not-installed')
      })
    })

    it('respects ?category=email (narrows to 1 item)', async () => {
      await withTestDatabase(async (db) => {
        const { workspace } = seedWorld(db)
        const app = createApp({ db, logger: silentLogger, claudeMarketplacesReader: () => [], marketplaceInstalledPluginsReader: noInstalledPlugins })
        const res = await app.request(`/workspaces/${workspace.id}/marketplace/items?category=email`)
        expect(res.status).toBe(200)
        const body = (await res.json()) as unknown[]
        expect(body).toHaveLength(1)
      })
    })

    it('respects ?category=documents (narrows to 0)', async () => {
      await withTestDatabase(async (db) => {
        const { workspace } = seedWorld(db)
        const app = createApp({ db, logger: silentLogger, claudeMarketplacesReader: () => [], marketplaceInstalledPluginsReader: noInstalledPlugins })
        const res = await app.request(
          `/workspaces/${workspace.id}/marketplace/items?category=documents`,
        )
        expect(res.status).toBe(200)
        const body = (await res.json()) as unknown[]
        expect(body).toHaveLength(0)
      })
    })

    it('respects ?installState=installed (0 before install, 1 after a real install)', async () => {
      await withIsolatedFs(async (workspacePath) => {
        await withTestDatabase(async (db) => {
          const { workspace } = seedWorld(db, workspacePath)
          const app = createApp({ db, logger: silentLogger, claudeMarketplacesReader: () => [], marketplaceInstalledPluginsReader: noInstalledPlugins })

          const before = await app.request(
            `/workspaces/${workspace.id}/marketplace/items?installState=installed`,
          )
          expect((await before.json()) as unknown[]).toHaveLength(0)

          const installRes = await app.request(`/workspaces/${workspace.id}/skills/install`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ skillId: 'email-drafter', scope: 'user' }),
          })
          expect(installRes.status).toBe(201)

          const after = await app.request(
            `/workspaces/${workspace.id}/marketplace/items?installState=installed`,
          )
          const afterBody = (await after.json()) as Array<{
            itemId: string
            installStatus: { kind: string; scope?: string }
          }>
          expect(afterBody).toHaveLength(1)
          expect(afterBody[0]?.installStatus).toMatchObject({
            kind: 'installed',
            scope: 'user',
          })
        })
      })
    })
  })

  describe('GET /workspaces/:workspaceId/marketplace/items/:itemId', () => {
    it('returns 200 with the annotated item for email-drafter', async () => {
      await withTestDatabase(async (db) => {
        const { workspace } = seedWorld(db)
        const app = createApp({ db, logger: silentLogger, claudeMarketplacesReader: () => [], marketplaceInstalledPluginsReader: noInstalledPlugins })
        const res = await app.request(`/workspaces/${workspace.id}/marketplace/items/email-drafter`)
        expect(res.status).toBe(200)
        const body = (await res.json()) as { itemId: string; installStatus: { kind: string } }
        expect(body.itemId).toBe('email-drafter')
        expect(body.installStatus.kind).toBe('not-installed')
      })
    })

    it('returns 404 with code=not_found for an unknown itemId', async () => {
      await withTestDatabase(async (db) => {
        const { workspace } = seedWorld(db)
        const app = createApp({ db, logger: silentLogger, claudeMarketplacesReader: () => [], marketplaceInstalledPluginsReader: noInstalledPlugins })
        const res = await app.request(`/workspaces/${workspace.id}/marketplace/items/no-such-item`)
        expect(res.status).toBe(404)
        const body = (await res.json()) as { code: string }
        expect(body.code).toBe('not_found')
      })
    })
  })
})
