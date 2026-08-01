// The hub's signing capability as an injectable seam: the app wires ONE
// signer from `CLOUD_ARTIFACT_SIGNING_PRIVATE_KEY` (when set) and every
// publish path carries it. The algorithm itself lives in
// `@vynel/contracts/hub/artifact-signing.ts` — the one home the desktop's
// verifier shares.

import { signArtifactSha256 } from '@vynel/contracts/hub/artifact-signing'

export interface ArtifactSigner {
  /** Base64 Ed25519 signature over an artifact's lowercase-hex sha256. */
  sign(sha256Hex: string): string
}

export function createArtifactSigner(privateKeyPem: string): ArtifactSigner {
  return { sign: (sha256Hex) => signArtifactSha256(privateKeyPem, sha256Hex) }
}
