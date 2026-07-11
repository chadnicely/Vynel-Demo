// The download decision + artifact read at the leaf, over PGlite + the
// in-memory store: the fail-CLOSED gates (no live account, tier below the
// item's minimum, unpublished, unknown version) and the integrity fault on
// missing bytes. The HTTP shape of the same gates stays covered by
// apps/cloud-api/src/routes/catalog.test.ts.

import { describe, it, expect } from 'vitest'
import { withTestCloudDatabase } from '@vynel/cloud-db/testing'
import { publishCatalogArtifact } from './publish-catalog-artifact.js'
import {
  authorizeCatalogDownload,
  loadCatalogArtifact,
  TierTooLowError,
  ArtifactMissingError,
} from './catalog-download.js'
import { createInMemoryArtifactStore } from './artifact-store.js'
import { setCatalogItemStatus } from './repositories/catalog-repository.js'
import type { PublishItemInput } from './publish-input.js'

const ARTIFACT = Buffer.from('zip-bytes-for-tests')

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

describe('authorizeCatalogDownload', () => {
  it('authorizes an entitled caller and returns the version integrity facts', async () => {
    await withTestCloudDatabase(async (db) => {
      const store = createInMemoryArtifactStore()
      const published = await publishCatalogArtifact(db, store, {
        ...publishInput(),
        artifactBytes: ARTIFACT,
      })
      const authorized = await authorizeCatalogDownload(db, {
        itemId: published.itemId,
        version: published.version,
        callerTier: 'basic',
      })
      expect(authorized.artifactSha256).toMatch(/^[0-9a-f]{64}$/)
      expect(authorized.artifactSize).toBe(ARTIFACT.length)
    })
  })

  it('denies when no active account stands behind the token (null tier)', async () => {
    await withTestCloudDatabase(async (db) => {
      await publishCatalogArtifact(db, createInMemoryArtifactStore(), {
        ...publishInput(),
        artifactBytes: ARTIFACT,
      })
      await expect(
        authorizeCatalogDownload(db, { itemId: 'email-drafter', version: '1.0.0', callerTier: null }),
      ).rejects.toBeInstanceOf(TierTooLowError)
    })
  })

  it('denies a basic caller on a pro item', async () => {
    await withTestCloudDatabase(async (db) => {
      await publishCatalogArtifact(db, createInMemoryArtifactStore(), {
        ...publishInput({ itemId: 'pro-agent', displayName: 'Pro Agent', minimumTier: 'pro' }),
        artifactBytes: ARTIFACT,
      })
      await expect(
        authorizeCatalogDownload(db, { itemId: 'pro-agent', version: '1.0.0', callerTier: 'basic' }),
      ).rejects.toBeInstanceOf(TierTooLowError)
      await expect(
        authorizeCatalogDownload(db, { itemId: 'pro-agent', version: '1.0.0', callerTier: 'pro' }),
      ).resolves.toMatchObject({ artifactSize: ARTIFACT.length })
    })
  })

  it('answers not-found for an unpublished item and an unknown version', async () => {
    await withTestCloudDatabase(async (db) => {
      await publishCatalogArtifact(db, createInMemoryArtifactStore(), {
        ...publishInput(),
        artifactBytes: ARTIFACT,
      })
      await expect(
        authorizeCatalogDownload(db, { itemId: 'email-drafter', version: '9.9.9', callerTier: 'pro' }),
      ).rejects.toMatchObject({ httpStatus: 404 })

      await setCatalogItemStatus(db, { itemId: 'email-drafter', status: 'draft' })
      await expect(
        authorizeCatalogDownload(db, { itemId: 'email-drafter', version: '1.0.0', callerTier: 'pro' }),
      ).rejects.toMatchObject({ httpStatus: 404 })
    })
  })
})

// The literal 'email-drafter@1.0.0.zip' keys below deliberately PIN the key
// format instead of calling artifactKey(): changing that format would orphan
// every already-stored artifact, so it must fail a test loudly.
describe('loadCatalogArtifact', () => {
  it('returns the stored bytes, and surfaces missing bytes as an integrity fault', async () => {
    const store = createInMemoryArtifactStore()
    await expect(
      loadCatalogArtifact(store, { itemId: 'email-drafter', version: '1.0.0' }),
    ).rejects.toBeInstanceOf(ArtifactMissingError)

    await store.put('email-drafter@1.0.0.zip', ARTIFACT)
    await expect(
      loadCatalogArtifact(store, { itemId: 'email-drafter', version: '1.0.0' }),
    ).resolves.toEqual(ARTIFACT)
  })
})

describe('publishCatalogArtifact', () => {
  it('rejects an empty artifact before touching the store', async () => {
    await withTestCloudDatabase(async (db) => {
      const store = createInMemoryArtifactStore()
      await expect(
        publishCatalogArtifact(db, store, { ...publishInput(), artifactBytes: Buffer.alloc(0) }),
      ).rejects.toMatchObject({ httpStatus: 400 })
      expect(await store.exists('email-drafter@1.0.0.zip')).toBe(false)
    })
  })

  it('a rejected republish never overwrites the stored bytes (byte-immutability)', async () => {
    await withTestCloudDatabase(async (db) => {
      const store = createInMemoryArtifactStore()
      await publishCatalogArtifact(db, store, { ...publishInput(), artifactBytes: ARTIFACT })

      await expect(
        publishCatalogArtifact(db, store, {
          ...publishInput(),
          artifactBytes: Buffer.from('different bytes'),
        }),
      ).rejects.toMatchObject({ httpStatus: 409 })
      expect(await store.get('email-drafter@1.0.0.zip')).toEqual(ARTIFACT)
    })
  })
})
