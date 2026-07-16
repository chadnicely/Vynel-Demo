// The OS credential store impl of `MasterKeyVault` (Windows Credential
// Manager via @napi-rs/keyring) — the native dep is QUARANTINED to this file
// behind its own subpath export (`@vynel/ssh-servers/keyring`), the
// hub-account keyring-vault precedent. Only `server.ts` imports this; tests
// and generators use the in-memory vault.

import { Entry } from '@napi-rs/keyring'
import type { MasterKeyVault } from './master-key.js'

const KEYRING_SERVICE = 'vynel-ssh'
const KEYRING_ENTRY = 'credentials-master-key'

export function createKeyringMasterKeyVault(): MasterKeyVault {
  const entry = new Entry(KEYRING_SERVICE, KEYRING_ENTRY)
  return {
    load() {
      try {
        return entry.getPassword()
      } catch {
        // The keyring API throws for "no entry" — that IS the first-use state.
        return null
      }
    },
    store(keyBase64) {
      entry.setPassword(keyBase64)
    },
  }
}
