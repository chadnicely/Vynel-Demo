// Folder-name sanitizer — turns a display name into ONE safe path segment.
// Replaces characters unsafe across OSes (Windows is strictest) + the C0
// control range with `_`, trims, and — critically — refuses to be a traversal:
// a name of `.` or `..` (or one that sanitizes to them) would let a minted
// project escape its parent (`<home>/..` is the home's PARENT), so it falls
// back to "workspace". The new-project scaffold derives a folder from a
// display name; the pull-in flow adopts an existing directory and never calls
// this.
//
// Pattern built without a literal control-char regex so the source stays
// lint-clean.

const UNSAFE_FOLDER_NAME_PATTERN = new RegExp('[<>:"/\\\\|?*' + '\\u0000-\\u001f' + ']', 'g')

export function sanitizeFolderName(rawName: string): string {
  const cleaned = rawName.replace(UNSAFE_FOLDER_NAME_PATTERN, '_').trim()
  // `.` and `..` are directory traversals, never a folder NAME — a minted
  // project must land inside the home, never at or above it.
  if (cleaned === '' || cleaned === '.' || cleaned === '..') return 'workspace'
  return cleaned
}
