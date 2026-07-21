// Parse a human key spec ("enter", "ctrl+c", "alt+f4") into nut.js Key enum
// values for a chorded press. Pure — the Key MAP is nut.js's own enum, passed
// in by the caller (so this stays binary-free and unit-testable). Unknown
// tokens throw an actionable error rather than silently pressing nothing.

// Token → nut.js Key enum NAME. Covers modifiers, navigation, editing, function
// keys, letters, digits, and common punctuation — the keys a desktop task needs.
const KEY_NAME_BY_TOKEN: Record<string, string> = {
  // modifiers
  ctrl: 'LeftControl',
  control: 'LeftControl',
  shift: 'LeftShift',
  alt: 'LeftAlt',
  option: 'LeftAlt',
  win: 'LeftSuper',
  super: 'LeftSuper',
  cmd: 'LeftSuper',
  meta: 'LeftSuper',
  // navigation / editing
  enter: 'Enter',
  return: 'Enter',
  tab: 'Tab',
  esc: 'Escape',
  escape: 'Escape',
  space: 'Space',
  spacebar: 'Space',
  backspace: 'Backspace',
  delete: 'Delete',
  del: 'Delete',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  // punctuation
  comma: 'Comma',
  period: 'Period',
  dot: 'Period',
  minus: 'Minus',
  slash: 'Slash',
  semicolon: 'Semicolon',
  quote: 'Quote',
  grave: 'Grave',
}

function tokenToKeyName(token: string): string | null {
  const named = KEY_NAME_BY_TOKEN[token]
  if (named !== undefined) return named
  // Single letter a-z → Key.A..Z
  if (/^[a-z]$/.test(token)) return token.toUpperCase()
  // Single digit 0-9 → Key.Num0..Num9
  if (/^[0-9]$/.test(token)) return `Num${token}`
  // Function keys f1..f24 → Key.F1..F24
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(token)) return token.toUpperCase()
  return null
}

/**
 * Resolve a key spec to an ordered list of nut.js Key values for a chord.
 * `keyEnum` is nut.js's `Key` record (token names → numbers). Modifiers first
 * keeps a shortcut like "ctrl+shift+t" pressing modifiers before the letter.
 */
export function parseKeyCombo(spec: string, keyEnum: Record<string, number>): number[] {
  const tokens = spec
    .split('+')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0)
  if (tokens.length === 0) {
    throw new Error('Empty key spec — pass a key like "enter" or a combo like "ctrl+c".')
  }
  const keys: number[] = []
  for (const token of tokens) {
    const keyName = tokenToKeyName(token)
    const value = keyName !== null ? keyEnum[keyName] : undefined
    if (keyName === null || value === undefined) {
      throw new Error(
        `Unknown key "${token}" in "${spec}". Use names like enter, tab, esc, up, f5, a, 1, or combos ` +
          'like ctrl+c / alt+f4.',
      )
    }
    keys.push(value)
  }
  return keys
}
