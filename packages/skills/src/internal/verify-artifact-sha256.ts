// The ONE integrity gate for cloud skill artifacts — sha256(bytes) must
// match the catalog's recorded hash BEFORE anything is parsed or written
// (M4a's SHA is the trust anchor; a mismatch means tampered/corrupt bytes).
// Lowercase both sides: digest('hex') emits lowercase, but a hub record
// may carry uppercase hex — casing must never fail a valid hash.

import { createHash } from 'node:crypto'
import { ValidationError } from '@vynel/errors'

const MISMATCH_MESSAGES = {
  install: 'The downloaded skill failed its integrity check (sha256 mismatch) — install aborted.',
  update:
    'The downloaded skill update failed its integrity check (sha256 mismatch) — update aborted.',
} as const

export function verifyArtifactSha256(
  artifactBytes: Buffer,
  expectedSha256: string,
  operation: 'install' | 'update',
): void {
  const actualSha256 = createHash('sha256').update(artifactBytes).digest('hex')
  if (actualSha256.toLowerCase() !== expectedSha256.toLowerCase()) {
    throw new ValidationError(MISMATCH_MESSAGES[operation])
  }
}
