// Where the long-lived refresh secret lives on the user's machine. The
// contract keeps the native credential store swappable (tests use the
// in-memory fake; the keyring impl is quarantined in keyring-vault.ts).

export interface RefreshTokenVault {
  load(): Promise<string | null>
  store(secret: string): Promise<void>
  clear(): Promise<void>
}

export function createInMemoryRefreshTokenVault(initial?: string): RefreshTokenVault {
  let secret: string | null = initial ?? null
  return {
    async load() {
      return secret
    },
    async store(next) {
      secret = next
    },
    async clear() {
      secret = null
    },
  }
}
