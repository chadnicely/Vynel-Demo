// AES-256-GCM sealing for credentials at rest — pure crypto, master key
// passed in (the keyring vault that HOLDS the key is a separate, quarantined
// concern). Per-secret random nonce; the GCM tag makes tampering loud.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const NONCE_BYTES = 12
export const MASTER_KEY_BYTES = 32

export interface SealedSecret {
  nonce: string // base64
  ciphertext: string // base64
  tag: string // base64
}

function toKeyBuffer(masterKeyBase64: string): Buffer {
  const key = Buffer.from(masterKeyBase64, 'base64')
  if (key.length !== MASTER_KEY_BYTES) {
    throw new Error(`sealSecret: master key must be ${MASTER_KEY_BYTES} bytes`)
  }
  return key
}

export function sealSecret(masterKeyBase64: string, plaintext: string): string {
  const key = toKeyBuffer(masterKeyBase64)
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, nonce)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const sealed: SealedSecret = {
    nonce: nonce.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  }
  return JSON.stringify(sealed)
}

export function openSecret(masterKeyBase64: string, sealedJson: string): string {
  const key = toKeyBuffer(masterKeyBase64)
  const sealed = JSON.parse(sealedJson) as SealedSecret
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(sealed.nonce, 'base64'))
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'))
  // A wrong key or tampered blob throws here (GCM auth failure) — callers
  // treat that as "credentials unreadable", never as empty credentials.
  return Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}
