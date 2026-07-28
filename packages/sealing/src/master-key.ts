// The master-key vault seam — everything programs against this interface;
// the OS-keyring impl is quarantined in `keyring-master-key-vault.ts` (its
// own subpath export) so tests and the generators never load the native dep.

import { randomBytes } from 'node:crypto'
import { MASTER_KEY_BYTES } from './seal-secret.js'

export interface MasterKeyVault {
  load(): string | null
  store(keyBase64: string): void
}

/** Load the master key, minting one on first use (the install's one-time
 *  key-generation moment). */
export function resolveMasterKey(vault: MasterKeyVault): string {
  const existing = vault.load()
  if (existing !== null) return existing
  const minted = randomBytes(MASTER_KEY_BYTES).toString('base64')
  vault.store(minted)
  return minted
}

/** Test double — a process-local key that never touches the OS store. */
export function createInMemoryMasterKeyVault(): MasterKeyVault {
  let stored: string | null = null
  return {
    load: () => stored,
    store: (keyBase64) => {
      stored = keyBase64
    },
  }
}
