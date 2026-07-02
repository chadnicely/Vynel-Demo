// Path visibility + write-target safety for the `files` domain. Pure — no fs.
// `isHiddenEntry` / `isUnderHiddenFolder` drive the default-hidden filter (D11);
// `assertWritableTarget` is the second policy guard rejecting writes to
// Vynel-managed `.vynel/` state (after path-containment is proven elsewhere).

import { ValidationError } from '@vynel/errors'

// Hidden by default per D11 — `.vynel/`, `node_modules/`, `.git/`,
// dotfiles. `includeHidden=true` opt-in surfaces them. Stored relative
// to the workspace root, forward-slash, WITHOUT a leading slash.
const HIDDEN_FOLDER_PREFIXES = ['.vynel', 'node_modules', '.git'] as const

// `.vynel/` is Vynel-managed internal state — writes/deletes targeting
// it are rejected (D11). Listing CAN show it on
// `includeHidden=true`, but mutations never.
const WRITE_REJECTED_FIRST_SEGMENTS = ['.vynel'] as const

// Whether a directory entry name should be hidden by default. A name
// is hidden if it starts with '.' or matches the hidden-folder set.
export function isHiddenEntry(name: string): boolean {
  if (name.startsWith('.')) return true
  return HIDDEN_FOLDER_PREFIXES.includes(name as (typeof HIDDEN_FOLDER_PREFIXES)[number])
}

// Whether a (forward-slash) workspace-relative path lives under a
// hidden folder. Used by listDirectory when traversing nested levels
// the UI fetches via subsequent calls — the entry-level isHiddenEntry
// is enough for one-level listings, but the parent-prefix variant
// matters for safety checks.
export function isUnderHiddenFolder(normalizedRelativePath: string): boolean {
  if (normalizedRelativePath === '') return false
  const segments = normalizedRelativePath.split('/')
  for (const segment of segments) {
    if (isHiddenEntry(segment)) return true
  }
  return false
}

// Mutation guard — rejects writes/deletes targeting Vynel-managed
// internal state (`.vynel/...`). The path-safety helper has already
// proven containment; this layers a second policy guard.
export function assertWritableTarget(normalizedRelativePath: string): void {
  if (normalizedRelativePath === '') {
    throw new ValidationError('You cannot write to the workspace root directly.')
  }
  const firstSegment = normalizedRelativePath.split('/')[0]!
  if (
    WRITE_REJECTED_FIRST_SEGMENTS.includes(
      firstSegment as (typeof WRITE_REJECTED_FIRST_SEGMENTS)[number],
    )
  ) {
    throw new ValidationError('That path is reserved by Vynel and not writable from here.')
  }
}
