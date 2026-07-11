// Where marketplace artifact BYTES live. The interface keeps the backend
// swappable: v1 is a filesystem dir on the hub (no infra); the object-storage
// move (R2/S3) implements the same shape and the download route can then
// return a redirect instead of bytes (cloud-api.md §5). Keys are derived from
// the already-validated itemId (kebab) + version (semver) — no user path
// input reaches the filesystem.
//
// Registry-owned: the store is the registry's artifact seam (publish writes,
// download reads); the app only wires WHICH backend (env → filesystem dir).

import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { resolve, sep } from 'node:path'

export interface ArtifactStore {
  put(key: string, bytes: Buffer): Promise<void>
  get(key: string): Promise<Buffer | null>
  exists(key: string): Promise<boolean>
}

/** itemId + version → a flat, filesystem-safe key. Both inputs are validated
 * (kebab / semver) before they reach here; the sanitize is defense-in-depth. */
export function artifactKey(itemId: string, version: string): string {
  const safe = (part: string): string => part.replace(/[^a-zA-Z0-9._-]/g, '_')
  return `${safe(itemId)}@${safe(version)}.zip`
}

/** In-memory store — for tests and a no-disk dev default. */
export function createInMemoryArtifactStore(): ArtifactStore {
  const store = new Map<string, Buffer>()
  return {
    async put(key, bytes) {
      store.set(key, bytes)
    },
    async get(key) {
      return store.get(key) ?? null
    },
    async exists(key) {
      return store.has(key)
    },
  }
}

export function createFilesystemArtifactStore(rootDir: string): ArtifactStore {
  const root = resolve(rootDir)

  function pathFor(key: string): string {
    const full = resolve(root, key)
    // Containment: a key can't escape the artifact dir.
    if (full !== root && !full.startsWith(root + sep)) {
      throw new Error(`artifact key escapes the store root: ${key}`)
    }
    return full
  }

  return {
    async put(key, bytes) {
      await mkdir(root, { recursive: true })
      await writeFile(pathFor(key), bytes)
    },
    async get(key) {
      try {
        return await readFile(pathFor(key))
      } catch {
        return null
      }
    },
    async exists(key) {
      try {
        await access(pathFor(key))
        return true
      } catch {
        return false
      }
    },
  }
}
