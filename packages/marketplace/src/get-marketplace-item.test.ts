// Tests for `getMarketplaceItem` — catalog lookup + install-status
// annotation. The installed-skills read is INJECTED, so these tests
// supply a fake `listInstalledSkills`; the unknown-id case throws
// before the reader is ever consulted. A real (empty) SQLite handle is
// passed so nothing is mocked. The real-DB installed join is covered by
// the route integration test in apps/local-api.
//
// Spec: blueprint §13.2 + coding.md §8.2.

import { describe, it, expect } from 'vitest'
import { withTestDatabase } from '@vynel/testing'
import { NotFoundError } from '@vynel/errors'
import { getMarketplaceItem } from './get-marketplace-item.js'
import type { InstalledSkillView, MarketplaceDeps } from './marketplace-types.js'

function depsReturning(installed: InstalledSkillView[]): MarketplaceDeps {
  return { listInstalledSkills: () => installed }
}

const owner = { userId: 'user-1', workspaceId: 'ws-1' }

describe('getMarketplaceItem', () => {
  it('returns the annotated item for a known catalog id (email-drafter)', async () => {
    await withTestDatabase(async (db) => {
      const item = getMarketplaceItem(db, { itemId: 'email-drafter', ...owner }, depsReturning([]))
      expect(item.itemId).toBe('email-drafter')
      expect(item.publisherTier).toBe('verified')
      expect(item.installStatus.kind).toBe('not-installed')
    })
  })

  it('returns installed status when the reader reports the skill installed', async () => {
    await withTestDatabase(async (db) => {
      const item = getMarketplaceItem(
        db,
        { itemId: 'email-drafter', ...owner },
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
      expect(item.installStatus).toMatchObject({
        kind: 'installed',
        scope: 'user',
        installedSkillId: 'u1',
        versionInstalled: '1.0.0',
      })
    })
  })

  it('throws NotFoundError for an unknown itemId', async () => {
    await withTestDatabase(async (db) => {
      expect(() =>
        getMarketplaceItem(db, { itemId: 'no-such-item', ...owner }, depsReturning([])),
      ).toThrow(NotFoundError)
    })
  })
})
