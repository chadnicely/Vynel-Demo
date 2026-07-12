// The registry leaf over a real Postgres dialect (PGlite): publish → browse →
// detail, tier annotation, republish conflict, and draft/unpublished hiding.

import { describe, it, expect } from 'vitest'
import { withTestCloudDatabase } from '@vynel/cloud-db/testing'
import { listCatalog } from './list-catalog.js'
import { getCatalogItemDetail } from './get-catalog-item.js'
import { publishItemVersion } from './publish-item-version.js'
import { setCatalogItemStatus } from './repositories/catalog-repository.js'
import { PublishItemSchema, type PublishItemInput } from './publish-input.js'

function publishInput(over: Partial<PublishItemInput['item']> = {}): PublishItemInput {
  return {
    publisher: { id: 'vynel-team', name: 'Vynel Team', tier: 'verified', url: null },
    item: {
      itemId: 'email-drafter',
      kind: 'skill',
      displayName: 'Email Drafter',
      oneLineDescription: 'Drafts emails.',
      category: 'email',
      iconName: 'mail',
      recommendedScope: 'user',
      minimumTier: 'basic',
      status: 'published',
      ...over,
    },
    version: { version: '1.0.0', changelog: 'first', manifest: { entry: 'SKILL.md' }, minAppVersion: null },
  }
}

const facts = { artifactSha256: 'a'.repeat(64), artifactSize: 128 }

describe('registry', () => {
  it('publishes then browses with tier-annotated canInstall', async () => {
    await withTestCloudDatabase(async (db) => {
      await publishItemVersion(db, publishInput(), facts)
      await publishItemVersion(
        db,
        publishInput({ itemId: 'pro-agent', kind: 'agent', displayName: 'Pro Agent', minimumTier: 'pro' }),
        facts,
      )

      const asBasic = await listCatalog(db, { callerTier: 'basic' })
      expect(asBasic.map((i) => i.itemId).sort()).toEqual(['email-drafter', 'pro-agent'])
      expect(asBasic.find((i) => i.itemId === 'email-drafter')?.canInstall).toBe(true)
      expect(asBasic.find((i) => i.itemId === 'pro-agent')?.canInstall).toBe(false)

      const asPro = await listCatalog(db, { callerTier: 'pro' })
      expect(asPro.every((i) => i.canInstall)).toBe(true)
    })
  })

  it('exposes versions in detail and rejects republishing a version', async () => {
    await withTestCloudDatabase(async (db) => {
      await publishItemVersion(db, publishInput(), facts)
      await publishItemVersion(
        db,
        { ...publishInput(), version: { version: '1.1.0', changelog: 'more', manifest: {}, minAppVersion: null } },
        facts,
      )
      const detail = await getCatalogItemDetail(db, { itemId: 'email-drafter', callerTier: 'basic' })
      expect(detail.versions.map((v) => v.version)).toEqual(['1.1.0', '1.0.0'])
      expect(detail.latestVersion).toBe('1.1.0')

      await expect(publishItemVersion(db, publishInput(), facts)).rejects.toMatchObject({
        code: 'conflict',
      })
    })
  })

  it('hides draft/yanked items from browse and detail', async () => {
    await withTestCloudDatabase(async (db) => {
      await publishItemVersion(db, publishInput(), facts)
      await setCatalogItemStatus(db, { itemId: 'email-drafter', status: 'yanked' })
      expect(await listCatalog(db, { callerTier: 'pro' })).toEqual([])
      await expect(
        getCatalogItemDetail(db, { itemId: 'email-drafter', callerTier: 'pro' }),
      ).rejects.toMatchObject({ code: 'not_found' })
    })
  })
})

describe('PublishItemSchema reserved ids', () => {
  it("rejects itemId 'publish' — the portal routes /catalog/publish as its own page", () => {
    const input = publishInput()
    const result = PublishItemSchema.safeParse({
      ...input,
      item: { ...input.item, itemId: 'publish' },
    })
    expect(result.success).toBe(false)
  })
})

describe('PublishItemSchema recommendedScope', () => {
  it("accepts 'both' — an item can fit the user AND workspace levels", () => {
    const input = publishInput({ recommendedScope: 'both' })
    const result = PublishItemSchema.safeParse(input)
    expect(result.success).toBe(true)
  })
})
