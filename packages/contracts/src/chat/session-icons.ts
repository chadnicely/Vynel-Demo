// The curated session-icon vocabulary — the ONE list of names the assistant
// may stamp on a session to say what it is for ("Email Feature Manager" wears
// `mail`). Semantic names, not glyph names: the wire and the DB store the
// MEANING; each surface maps it to its own icon language (the web app renders
// Phosphor glyphs). Unknown or unset falls back to the session's monogram, so
// the vocabulary can grow without a migration and an old client never breaks.

export const SESSION_ICONS = [
  'mail',
  'code',
  'bug',
  'web',
  'database',
  'docs',
  'chart',
  'calendar',
  'robot',
  'build',
  'test',
  'search',
  'chat',
  'rocket',
  'shield',
  'design',
  'media',
  'book',
  'gear',
  'users',
  'idea',
  'folder',
  'terminal',
  'git',
  'lock',
  'bell',
  'clock',
  'package',
  'phone',
  'money',
] as const

export type SessionIcon = (typeof SESSION_ICONS)[number]

/** Boundary guard — routes and tools accept only catalog names; anything else
 *  is treated as unset rather than stored as a name no surface can draw. */
export function isSessionIcon(value: unknown): value is SessionIcon {
  return typeof value === 'string' && (SESSION_ICONS as readonly string[]).includes(value)
}
