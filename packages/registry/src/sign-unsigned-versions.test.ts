// Signing over PGlite + the in-memory store: a publish with a signer lands a
// verifiable signature; the backfill signs only what it can BLESS — legacy
// unsigned rows with intact bytes — and reports (never signs) missing or
// corrupt artifacts. Second run finds nothing (idempotent).

import { generateKeyPairSync } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import { withTestCloudDatabase } from '@vynel/cloud-db/testing'
import { verifyArtifactSha256Signature } from '@vynel/contracts/hub/artifact-signing'
import { publishCatalogArtifact } from './publish-catalog-artifact.js'
import { createArtifactSigner } from './artifact-signer.js'
import { signUnsignedVersions } from './sign-unsigned-versions.js'
import { artifactKey, createInMemoryArtifactStore } from './artifact-store.js'
import { findItemVersion } from './repositories/catalog-repository.js'
import { zipArtifact } from './testing.js'
import type { PublishItemInput } from './publish-input.js'

// Publish inspects every artifact now — fixtures must be real zips. Distinct
// contents keep distinct shas (the corrupt/tampered cases depend on it).
const zips = {
  signed: await zipArtifact({ 'SKILL.md': 'signed bytes' }),
  unsigned: await zipArtifact({ 'SKILL.md': 'unsigned bytes' }),
  intact: await zipArtifact({ 'SKILL.md': 'intact bytes' }),
  gone: await zipArtifact({ 'SKILL.md': 'gone bytes' }),
  original: await zipArtifact({ 'SKILL.md': 'original bytes' }),
}

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const signer = createArtifactSigner(
  privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
)
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()

function publishInput(itemId: string): PublishItemInput {
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
      status: 'published',
    },
    version: { version: '1.0.0', changelog: '', manifest: { entry: 'SKILL.md' }, minAppVersion: null },
  }
}

describe('artifact signatures at publish', () => {
  it('a signer-carrying publish records a signature that verifies; none stays null', async () => {
    await withTestCloudDatabase(async (db) => {
      const store = createInMemoryArtifactStore()
      await publishCatalogArtifact(
        db,
        store,
        { ...publishInput('signed-skill'), artifactBytes: zips.signed },
        signer,
      )
      await publishCatalogArtifact(db, store, {
        ...publishInput('unsigned-skill'),
        artifactBytes: zips.unsigned,
      })

      const signed = await findItemVersion(db, { itemId: 'signed-skill', version: '1.0.0' })
      expect(signed?.artifactSignature).not.toBeNull()
      expect(
        verifyArtifactSha256Signature(
          publicPem,
          signed?.artifactSha256 ?? '',
          signed?.artifactSignature ?? '',
        ),
      ).toBe(true)
      const unsigned = await findItemVersion(db, { itemId: 'unsigned-skill', version: '1.0.0' })
      expect(unsigned?.artifactSignature).toBeNull()
    })
  })
})

describe('signUnsignedVersions', () => {
  it('signs intact legacy rows, refuses missing/corrupt bytes, and is idempotent', async () => {
    await withTestCloudDatabase(async (db) => {
      const store = createInMemoryArtifactStore()
      // Three unsigned legacy rows: intact, bytes-gone, bytes-corrupted.
      await publishCatalogArtifact(db, store, {
        ...publishInput('intact'),
        artifactBytes: zips.intact,
      })
      await publishCatalogArtifact(db, store, {
        ...publishInput('gone'),
        artifactBytes: zips.gone,
      })
      await publishCatalogArtifact(db, store, {
        ...publishInput('corrupt'),
        artifactBytes: zips.original,
      })
      // The backfill runs against a store where 'gone' was never written and
      // 'corrupt' no longer hashes to its recorded sha.
      const lossyStore = createInMemoryArtifactStore()
      await lossyStore.put(artifactKey('intact', '1.0.0'), zips.intact)
      await lossyStore.put(artifactKey('corrupt', '1.0.0'), Buffer.from('TAMPERED bytes'))

      const report = await signUnsignedVersions(db, lossyStore, signer)
      expect(report.signed).toEqual(['intact@1.0.0'])
      expect(report.missingBytes).toEqual(['gone@1.0.0'])
      expect(report.shaMismatch).toEqual(['corrupt@1.0.0'])

      const row = await findItemVersion(db, { itemId: 'intact', version: '1.0.0' })
      expect(
        verifyArtifactSha256Signature(
          publicPem,
          row?.artifactSha256 ?? '',
          row?.artifactSignature ?? '',
        ),
      ).toBe(true)

      // Idempotent: the signed row left the work list; the damaged two remain
      // reported, still unsigned.
      const second = await signUnsignedVersions(db, lossyStore, signer)
      expect(second.signed).toEqual([])
      expect(second.missingBytes).toEqual(['gone@1.0.0'])
      expect(second.shaMismatch).toEqual(['corrupt@1.0.0'])
    })
  })
})
