// The one-time backfill behind POST /admin/catalog/sign-missing: sign every
// version published before the hub had its artifact-signing key. Robust over
// strict — a bad row is REPORTED in its bucket and skipped, never thrown, so
// one damaged artifact can't block signing the rest. The integrity rule: a
// signature blesses bytes, so bytes whose recomputed sha no longer matches
// the row are never signed (that mismatch is a storage fault to investigate,
// and signing it would launder the corruption).

import { createHash } from 'node:crypto'
import type { CloudDatabase } from '@vynel/cloud-db'
import { artifactKey, type ArtifactStore } from './artifact-store.js'
import type { ArtifactSigner } from './artifact-signer.js'
import {
  listUnsignedItemVersions,
  setItemVersionSignature,
} from './repositories/catalog-repository.js'

export interface SignUnsignedVersionsReport {
  /** Rows that now carry a signature, as `itemId@version`. */
  readonly signed: string[]
  /** Rows whose artifact bytes are gone from the store — storage faults. */
  readonly missingBytes: string[]
  /** Rows whose stored bytes no longer hash to the recorded sha — NEVER
   *  signed; corrupt bytes must not be blessed. */
  readonly shaMismatch: string[]
}

export async function signUnsignedVersions(
  db: CloudDatabase,
  artifactStore: ArtifactStore,
  signer: ArtifactSigner,
): Promise<SignUnsignedVersionsReport> {
  const report: SignUnsignedVersionsReport = { signed: [], missingBytes: [], shaMismatch: [] }
  for (const row of await listUnsignedItemVersions(db)) {
    const label = `${row.itemId}@${row.version}`
    const bytes = await artifactStore.get(artifactKey(row.itemId, row.version))
    if (bytes === null) {
      report.missingBytes.push(label)
      continue
    }
    const actualSha256 = createHash('sha256').update(bytes).digest('hex')
    if (actualSha256.toLowerCase() !== row.artifactSha256.toLowerCase()) {
      report.shaMismatch.push(label)
      continue
    }
    await setItemVersionSignature(db, {
      id: row.id,
      artifactSignature: signer.sign(row.artifactSha256),
    })
    report.signed.push(label)
  }
  return report
}
