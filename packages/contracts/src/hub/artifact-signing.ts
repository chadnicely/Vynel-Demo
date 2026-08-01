// The artifact-signature ALGORITHM — the one home both sides import so they
// can never drift: the hub signs at publish (`@vynel/registry`), the desktop
// verifies at download (`@vynel/hub-account`). What is signed is the ASCII
// lowercase-hex sha256 of the artifact bytes (not the bytes — the desktop
// already recomputes that sha as its integrity anchor), Ed25519, signature
// carried base64. Pure node:crypto — no deps; browser bundles never import
// this file (contracts consumers import per-file).

import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'

/** Sign an artifact's lowercase-hex sha256 with the hub's Ed25519 private
 *  key (PEM). Returns the base64 signature stored on the version row. */
export function signArtifactSha256(privateKeyPem: string, sha256Hex: string): string {
  const key = createPrivateKey(privateKeyPem)
  return sign(null, Buffer.from(sha256Hex.toLowerCase(), 'utf8'), key).toString('base64')
}

/** Verify a version's signature against the recomputed sha256. Casing on the
 *  hex must never fail a valid signature (the sha comparison rule). A
 *  malformed signature/key verifies as false, never throws — the caller maps
 *  false to its own typed error. */
export function verifyArtifactSha256Signature(
  publicKeyPem: string,
  sha256Hex: string,
  signatureBase64: string,
): boolean {
  try {
    const key = createPublicKey(publicKeyPem)
    return verify(
      null,
      Buffer.from(sha256Hex.toLowerCase(), 'utf8'),
      key,
      Buffer.from(signatureBase64, 'base64'),
    )
  } catch {
    return false
  }
}
