// Public surface of `@vynel/sealing` — SHARED secret-at-rest crypto: AES-256-GCM
// sealing against a machine master key, plus the vault seam that holds that key
// (OS keyring on desktops, an owner-only file on headless servers). Extracted
// from the ssh-servers leaf when server-install became its second consumer —
// leaves import this like errors/logger; they never import each other. The
// native OS-keyring impl stays quarantined on `./keyring` (its own subpath) so
// tests and generators never load the native dep.

export { sealSecret, openSecret } from './seal-secret.js'
export {
  resolveMasterKey,
  createInMemoryMasterKeyVault,
  type MasterKeyVault,
} from './master-key.js'
export { createFileMasterKeyVault } from './file-master-key-vault.js'
