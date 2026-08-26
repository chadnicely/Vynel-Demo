// The ONE predicate for "a file stem we can address inside a `.claude/`
// folder" — shared by every leaf that lists AND writes such files (rules,
// commands, agent files), so a file a view lists is always a file the doors
// can reach (and vice versa). Structural rather than a charset: the stem
// becomes `<stem>.md` inside a known folder, so it must be exactly one path
// segment — no separators, no `..`, no leading dot, no control bytes, and
// none of the characters Windows reserves (`:` would silently write an
// NTFS alternate data stream — a zero-length file that never lists; the
// rest fail at write time). A hand-named `Team Rules.md` or `règles.md`
// stays addressable; only names that could escape the folder, hide from a
// listing, or never land on disk are out.

export const MAX_FILE_STEM_LENGTH = 120

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\x00-\x1f\x7f]/
const RESERVED_CHARACTERS = /[<>:"|?*]/
// `nul.md` resolves to the NUL device on many Windows builds: the write
// "succeeds", nothing lands, nothing lists.
const RESERVED_DEVICE_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

export function isSafeFileStem(stem: string): boolean {
  if (stem.length === 0 || stem.length > MAX_FILE_STEM_LENGTH) return false
  if (stem.startsWith('.')) return false
  if (stem.trim() !== stem) return false
  if (stem.includes('/') || stem.includes('\\') || stem.includes('..')) return false
  if (CONTROL_CHARACTERS.test(stem) || RESERVED_CHARACTERS.test(stem)) return false
  if (RESERVED_DEVICE_NAMES.test(stem)) return false
  return true
}
