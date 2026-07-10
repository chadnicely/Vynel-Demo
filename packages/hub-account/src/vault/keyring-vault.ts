// The OS credential store impl (Windows Credential Manager via
// @napi-rs/keyring) — the discovery promise that the refresh token never
// sits in a plain file (cloud-api.md §3). The native dep is QUARANTINED to
// this file; everything else programs against `RefreshTokenVault`.

import { Entry } from '@napi-rs/keyring'
import type { RefreshTokenVault } from './refresh-token-vault.js'

const KEYRING_SERVICE = 'vynel-hub'
const KEYRING_ACCOUNT = 'refresh-token'

export function createKeyringRefreshTokenVault(): RefreshTokenVault {
  const entry = new Entry(KEYRING_SERVICE, KEYRING_ACCOUNT)
  return {
    async load() {
      try {
        return entry.getPassword()
      } catch {
        // The keyring API throws for "no entry" — that IS the signed-out state.
        return null
      }
    },
    async store(secret) {
      entry.setPassword(secret)
    },
    async clear() {
      try {
        entry.deletePassword()
      } catch {
        // Already absent — the outcome the caller wanted.
      }
    },
  }
}
