// Opaque secrets for refresh tokens + email action links: 256-bit random,
// stored as an UNSALTED sha256 (deterministic digest = O(1) unique-index
// lookup; a 256-bit random secret gains nothing from a slow salted hash —
// unlike passwords, which humans choose).

import { createHash, randomBytes } from 'node:crypto'

export function generateOpaqueSecret(): string {
  return randomBytes(32).toString('base64url')
}

export function hashOpaqueSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}
