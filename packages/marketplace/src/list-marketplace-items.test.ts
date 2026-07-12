// Tests for `listMarketplaceItems` — the browse pipeline (resolve
// catalog → read installed skills → annotate → filter → sort).
//
// The installed-skills read is INJECTED, so these tests supply a fake
// `listInstalledSkills` and assert the composition. The real-DB join
// (a real `installed_skills` row flipping an item to "installed") is
// covered end-to-end by the route integration test in
// `apps/local-api/src/routes/marketplace/index.test.ts`; userId /
// workspace isolation of the reader itself is covered in
// `@vynel/skills` (`installed-skills.test.ts`). A real (empty) SQLite
// handle is passed so nothing is mocked — it is the passthrough token
// the pipeline forwards to the injected reader.
//
// Spec: blueprint §13.2 + coding.md §8.2.

import { describe, it, expect, vi } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { listMarketplaceItems } from './list-marketplace-items.js'
import type { InstalledSkillView, MarketplaceDeps } from './marketplace-types.js'

function depsReturning(installed: InstalledSkillView[]): MarketplaceDeps {
  return { listInstalledSkills: () => installed, listInstalledAgents: () => [] }
}

const input = { userId: 'user-1', surface: 'workspace', workspaceId: 'ws-1' } as const

describe('listMarketplaceItems', () => {
  it('returns the Phase 1 catalog (1 visible item — email-drafter) annotated not-installed', async () => {
    await withTestDatabase(async (db) => {
      const items = listMarketplaceItems(db, input, depsReturning([]))
      // Catalog ships 1 entry (email-drafter); workspace-context retired in A2.
      expect(items).toHaveLength(1)
      expect(items[0]?.itemId).toBe('email-drafter')
      expect(items[0]?.skillId).toBe('email-drafter')
      expect(items[0]?.publisherTier).toBe('verified')
      expect(items[0]?.publisherName).toBe('Vynel Team')
      expect(items[0]?.isOfficial).toBe(true)
      expect(items[0]?.installStatus.kind).toBe('not-installed')
    })
  })

  it('forwards the db handle + userId/workspaceId to both injected readers', async () => {
    await withTestDatabase(async (db) => {
      const listInstalledSkills = vi.fn<MarketplaceDeps['listInstalledSkills']>(() => [])
      const listInstalledAgents = vi.fn<MarketplaceDeps['listInstalledAgents']>(() => [])
      listMarketplaceItems(db, input, { listInstalledSkills, listInstalledAgents })
      const owner = { userId: 'user-1', workspaceId: 'ws-1' }
      expect(listInstalledSkills).toHaveBeenCalledWith(db, owner)
      expect(listInstalledAgents).toHaveBeenCalledWith(db, owner)
    })
  })

  it('passes workspaceId: null to both readers on the GLOBAL surface (user-scope annotation only)', async () => {
    await withTestDatabase(async (db) => {
      const listInstalledSkills = vi.fn<MarketplaceDeps['listInstalledSkills']>(() => [])
      const listInstalledAgents = vi.fn<MarketplaceDeps['listInstalledAgents']>(() => [])
      listMarketplaceItems(
        db,
        { userId: 'user-1', surface: 'global' },
        { listInstalledSkills, listInstalledAgents },
      )
      const owner = { userId: 'user-1', workspaceId: null }
      expect(listInstalledSkills).toHaveBeenCalledWith(db, owner)
      expect(listInstalledAgents).toHaveBeenCalledWith(db, owner)
    })
  })

  it('flips email-drafter to installed-user-scope when the reader returns a user-scope row', async () => {
    await withTestDatabase(async (db) => {
      const items = listMarketplaceItems(
        db,
        input,
        depsReturning([
          {
            id: 'u1',
            skillId: 'email-drafter',
            workspaceId: null,
            scope: 'user',
            versionInstalled: '1.0.0',
          },
        ]),
      )
      expect(items[0]?.installStatus).toMatchObject({
        kind: 'installed',
        scope: 'user',
        installedId: 'u1',
        versionInstalled: '1.0.0',
      })
    })
  })

  it('flips email-drafter to installed-workspace-scope when the reader returns a workspace-scope row', async () => {
    await withTestDatabase(async (db) => {
      const items = listMarketplaceItems(
        db,
        input,
        depsReturning([
          {
            id: 'w1',
            skillId: 'email-drafter',
            workspaceId: 'ws-1',
            scope: 'workspace',
            versionInstalled: '1.0.0',
          },
        ]),
      )
      expect(items[0]?.installStatus).toMatchObject({
        kind: 'installed',
        scope: 'workspace',
        installedId: 'w1',
      })
    })
  })

  it('respects the category filter (email narrows to 1; documents narrows to 0)', async () => {
    await withTestDatabase(async (db) => {
      const emailItems = listMarketplaceItems(db, { ...input, category: 'email' }, depsReturning([]))
      expect(emailItems).toHaveLength(1)
      const docItems = listMarketplaceItems(
        db,
        { ...input, category: 'documents' },
        depsReturning([]),
      )
      expect(docItems).toHaveLength(0)
    })
  })

  it('respects the installState filter (flips with install state)', async () => {
    await withTestDatabase(async (db) => {
      // Before install: not-installed filter shows 1, installed shows 0.
      const before1 = listMarketplaceItems(
        db,
        { ...input, installState: 'not-installed' },
        depsReturning([]),
      )
      expect(before1).toHaveLength(1)
      const before2 = listMarketplaceItems(
        db,
        { ...input, installState: 'installed' },
        depsReturning([]),
      )
      expect(before2).toHaveLength(0)
      // After install (reader now returns the row).
      const after = listMarketplaceItems(
        db,
        { ...input, installState: 'installed' },
        depsReturning([
          {
            id: 'u1',
            skillId: 'email-drafter',
            workspaceId: null,
            scope: 'user',
            versionInstalled: '1.0.0',
          },
        ]),
      )
      expect(after).toHaveLength(1)
    })
  })
})
