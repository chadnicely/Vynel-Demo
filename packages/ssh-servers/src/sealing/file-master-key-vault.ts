// The file impl of `MasterKeyVault` — for headless servers (Phase D remote
// engines) where no OS Secret Service exists to back the keyring impl. The
// key file lives outside the payload in the install's data dir, owner-only
// (0600): the same custody level as ~/.ssh keys, and the DB stays useless
// ciphertext to anyone who copies it without also reading that file.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { MasterKeyVault } from './master-key.js'

export function createFileMasterKeyVault(keyFilePath: string): MasterKeyVault {
  return {
    load: () => {
      let contents: string
      try {
        contents = readFileSync(keyFilePath, 'utf8')
      } catch (error) {
        // Absent = first use (mint); anything else — EACCES, EISDIR — must
        // surface, or a permission problem would silently mint a second key
        // and orphan every previously sealed credential.
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      }
      const key = contents.trim()
      return key === '' ? null : key
    },
    store: (keyBase64) => {
      mkdirSync(dirname(keyFilePath), { recursive: true, mode: 0o700 })
      // Temp-then-rename: a torn write at mint time would leave a truncated
      // key on disk while the running process seals with the full one —
      // permanently orphaning every credential sealed that session.
      const stagingPath = `${keyFilePath}.tmp`
      writeFileSync(stagingPath, `${keyBase64}\n`, { mode: 0o600 })
      renameSync(stagingPath, keyFilePath)
    },
  }
}
