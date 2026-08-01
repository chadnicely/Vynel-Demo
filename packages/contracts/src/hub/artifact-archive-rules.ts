// The artifact-archive SAFETY RULES — the one home both sides import so they
// can never drift (the `artifact-signing.ts` precedent): the hub inspects a
// zip at publish (`@vynel/registry`), the desktop enforces the same wall
// before writing entries to disk (`@vynel/skills`). Pure constants and
// string/number predicates only — no zip-parsing dependency lives here; each
// side keeps its own extraction/inspection implementation.

/** Hub-side compressed-artifact cap; anything larger can never be a
 *  legitimate published item. Also the desktop's pre-parse zip-bomb wall. */
export const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024

export const MAX_ARCHIVE_ENTRIES = 200
/** Per-entry uncompressed cap. */
export const MAX_ARCHIVE_ENTRY_BYTES = 8 * 1024 * 1024
/** Whole-archive uncompressed cap (the zip-bomb backstop). */
export const MAX_ARCHIVE_TOTAL_UNCOMPRESSED_BYTES = 32 * 1024 * 1024

/**
 * Why an entry path is unsafe to ever write to disk, or null when it is
 * safe: backslashes, absolute paths, drive letters, and empty/`.`/`..`
 * segments are all refused. Callers wrap the reason into their own typed
 * error (`The <subject> entry '<name>' <reason>.`).
 */
export function archiveEntryPathViolation(name: string): string | null {
  if (name.includes('\\')) return 'uses an unsafe path'
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) return 'uses an absolute path'
  const segments = name.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return 'traverses outside the archive root'
  }
  return null
}

// Unix mode type bits ride the zip's external attributes; S_IFLNK marks a
// symlink entry — written to disk it could point anywhere.
const S_IFMT = 0o170000
const S_IFLNK = 0o120000

// `unknown` because zip libraries surface the mode loosely (jszip:
// `number | string | null`); anything non-numeric can't carry type bits.
export function isSymlinkUnixMode(mode: unknown): boolean {
  return typeof mode === 'number' && (mode & S_IFMT) === S_IFLNK
}
