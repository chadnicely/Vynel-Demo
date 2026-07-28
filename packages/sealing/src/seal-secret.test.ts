import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import { sealSecret, openSecret } from './seal-secret.js'
import { createInMemoryMasterKeyVault, resolveMasterKey } from './master-key.js'

describe('sealSecret / openSecret', () => {
  const key = randomBytes(32).toString('base64')

  it('round-trips a secret; every seal is unique (random nonce)', () => {
    const sealedA = sealSecret(key, 'hunter2')
    const sealedB = sealSecret(key, 'hunter2')
    expect(sealedA).not.toBe(sealedB)
    expect(openSecret(key, sealedA)).toBe('hunter2')
    expect(openSecret(key, sealedB)).toBe('hunter2')
    // The plaintext never appears in the blob.
    expect(sealedA).not.toContain('hunter2')
  })

  it('a wrong key or a tampered blob throws (GCM auth), never returns garbage', () => {
    const sealed = sealSecret(key, 'hunter2')
    const wrongKey = randomBytes(32).toString('base64')
    expect(() => openSecret(wrongKey, sealed)).toThrow()

    const parsed = JSON.parse(sealed) as { ciphertext: string }
    const tampered = JSON.stringify({
      ...JSON.parse(sealed),
      ciphertext: Buffer.from(
        Buffer.from(parsed.ciphertext, 'base64').map((byte) => byte ^ 0xff),
      ).toString('base64'),
    })
    expect(() => openSecret(key, tampered)).toThrow()
  })

  it('rejects a wrong-size master key', () => {
    expect(() => sealSecret(Buffer.from('short').toString('base64'), 'x')).toThrow(/32 bytes/)
  })
})

describe('resolveMasterKey', () => {
  it('mints once, then always returns the stored key', () => {
    const vault = createInMemoryMasterKeyVault()
    const first = resolveMasterKey(vault)
    expect(Buffer.from(first, 'base64')).toHaveLength(32)
    expect(resolveMasterKey(vault)).toBe(first)
  })
})
