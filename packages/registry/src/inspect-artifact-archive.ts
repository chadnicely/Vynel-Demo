// Server-side artifact inspection — the hub NEVER records a zip it hasn't
// looked inside. Runs on every publish path (direct upload and from-repo,
// both land in `publishCatalogArtifact`) and refuses what the desktop's
// write-to-disk extractor would refuse: invalid archives, traversal /
// absolute / backslash paths, symlink entries, case-fold collisions, and
// bomb-sized entries. The RULES are shared with the desktop through
// `@vynel/contracts/hub/artifact-archive-rules` (one home, per-side impls).
//
// Deliberately never inflates: entry names, modes, and declared sizes all
// come from the zip's central directory. Declared sizes can lie, but the
// desktop re-checks with post-inflate backstops at install time — the hub's
// job is to refuse obvious hostiles at the door, cheaply.

import JSZip from 'jszip'
import { ValidationError } from '@vynel/errors'
import {
  MAX_ARCHIVE_ENTRIES,
  MAX_ARCHIVE_ENTRY_BYTES,
  MAX_ARCHIVE_TOTAL_UNCOMPRESSED_BYTES,
  archiveEntryPathViolation,
  isSymlinkUnixMode,
} from '@vynel/contracts/hub/artifact-archive-rules'

export type ArtifactArchiveFacts = {
  /** Non-directory entries. */
  entryCount: number
  /** Sum of DECLARED uncompressed sizes (null-declared entries count 0). */
  declaredTotalBytes: number
}

// jszip does not expose an entry's DECLARED uncompressed size publicly — it
// sits on the internal `_data` compressed object populated by `loadAsync`.
// The access is defensive (unknown-typed): if a jszip upgrade moves the
// field this returns null and the size checks defer to the desktop's
// post-inflate backstops. Third copy of this dance (@vynel/skills,
// @vynel/agents carry the others) — a shared home needs a zip-capable
// package that doesn't exist; contracts stays zod-only by design.
function readDeclaredUncompressedSize(entry: JSZip.JSZipObject): number | null {
  const internals: unknown = entry
  if (typeof internals !== 'object' || internals === null) return null
  const compressedObject: unknown = (internals as Record<string, unknown>)['_data']
  if (typeof compressedObject !== 'object' || compressedObject === null) return null
  const declared: unknown = (compressedObject as Record<string, unknown>)['uncompressedSize']
  return typeof declared === 'number' && Number.isFinite(declared) ? declared : null
}

export async function inspectArtifactArchive(artifact: Buffer): Promise<ArtifactArchiveFacts> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(artifact)
  } catch {
    throw new ValidationError('The artifact is not a valid zip archive.')
  }

  const entries = Object.values(zip.files).filter((entry) => !entry.dir)
  if (entries.length === 0) {
    throw new ValidationError('The artifact archive is empty.')
  }
  if (entries.length > MAX_ARCHIVE_ENTRIES) {
    throw new ValidationError(
      `The artifact archive has too many entries (${entries.length} > ${MAX_ARCHIVE_ENTRIES}).`,
    )
  }

  let declaredTotalBytes = 0
  // Case-insensitive collision wall: on the default Windows/macOS
  // filesystems the desktop installs onto, case-variant duplicates would
  // silently last-write-win.
  const seenPathsFolded = new Set<string>()
  for (const entry of entries) {
    const violation = archiveEntryPathViolation(entry.name)
    if (violation !== null) {
      throw new ValidationError(`The artifact entry '${entry.name}' ${violation}.`)
    }
    if (isSymlinkUnixMode(entry.unixPermissions)) {
      throw new ValidationError(`The artifact entry '${entry.name}' is a symlink.`)
    }
    const folded = entry.name.toLowerCase()
    if (seenPathsFolded.has(folded)) {
      throw new ValidationError(
        `The artifact entry '${entry.name}' collides with another entry (case-insensitive).`,
      )
    }
    seenPathsFolded.add(folded)
    const declaredSize = readDeclaredUncompressedSize(entry)
    if (declaredSize !== null) {
      if (declaredSize > MAX_ARCHIVE_ENTRY_BYTES) {
        throw new ValidationError(
          `The artifact entry '${entry.name}' inflates past the per-file size limit.`,
        )
      }
      declaredTotalBytes += declaredSize
      if (declaredTotalBytes > MAX_ARCHIVE_TOTAL_UNCOMPRESSED_BYTES) {
        throw new ValidationError('The artifact archive inflates past the total size limit.')
      }
    }
  }

  return { entryCount: entries.length, declaredTotalBytes }
}
