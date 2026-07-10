// The OS credential store impl (Windows Credential Manager via
// @napi-rs/keyring) — the discovery promise that the refresh token never
// sits in a plain file (cloud-api.md §3). The native dep is QUARANTINED to
// this file; everything else programs against `RefreshTokenVault`.

import { Entry } from '@napi-rs/keyring'
import type { RefreshTokenVault } from './refresh-token-vault.js'

const KEYRING_SERVICE = 'vynel-hub'

export function createKeyringRefreshTokenVault(): RefreshTokenVault {
  return createKeyringVault('refresh-token')
}

/** The entitlement JWT gets its own entry: offline boots read tier +
 * features + identity from it without the hub (cloud-api.md §4). */
export function createKeyringEntitlementVault(): RefreshTokenVault {
  return createKeyringVault('entitlement')
}

function createKeyringVault(entryName: string): RefreshTokenVault {
  const entry = new Entry(KEYRING_SERVICE, entryName)
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
