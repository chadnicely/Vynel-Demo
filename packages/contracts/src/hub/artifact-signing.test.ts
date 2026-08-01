// The signing algorithm's contract: round-trip verifies, any tamper (bytes,
// key, signature) fails CLOSED as false — never a throw the caller must
// defend against.

import { generateKeyPairSync } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import { signArtifactSha256, verifyArtifactSha256Signature } from './artifact-signing.js'

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
const SHA = 'a'.repeat(64)

describe('artifact signing', () => {
  it('round-trips, tolerating hex casing on either side', () => {
    const signature = signArtifactSha256(privatePem, SHA.toUpperCase())
    expect(verifyArtifactSha256Signature(publicPem, SHA, signature)).toBe(true)
    expect(verifyArtifactSha256Signature(publicPem, SHA.toUpperCase(), signature)).toBe(true)
  })

  it('fails closed on a different sha, a foreign key, or garbage input', () => {
    const signature = signArtifactSha256(privatePem, SHA)
    expect(verifyArtifactSha256Signature(publicPem, 'b'.repeat(64), signature)).toBe(false)

    const foreign = generateKeyPairSync('ed25519')
      .publicKey.export({ type: 'spki', format: 'pem' })
      .toString()
    expect(verifyArtifactSha256Signature(foreign, SHA, signature)).toBe(false)

    expect(verifyArtifactSha256Signature(publicPem, SHA, 'not-base64!!')).toBe(false)
    expect(verifyArtifactSha256Signature('not a pem', SHA, signature)).toBe(false)
  })
})
