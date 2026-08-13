// Pure env-file text operations for the apps leaf — parsing a dotenv-style
// file into entries and merging a desired entry set back into the file text.
//
// LINE-PRESERVING BY DESIGN: the file belongs to the user's project, so
// comments, blank lines, and anything we don't understand survive a rewrite
// verbatim. Only KEY=VALUE lines are touched: updated in place (keeping an
// `export ` prefix if present), dropped when their key was removed, and new
// keys append at the end. Values are kept RAW — no unquoting on parse, no
// quoting on write — so what the user sees is exactly what the file says and
// a read→write round-trip is lossless.

export interface AppEnvEntry {
  key: string
  value: string
}

export const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

// `export KEY = value` tolerated on parse; group 1 = prefix, 2 = key, 3 = raw value.
const ENV_LINE_PATTERN = /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/

export function parseEnvFileText(text: string): AppEnvEntry[] {
  const entriesByKey = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const match = ENV_LINE_PATTERN.exec(line)
    if (!match) continue
    // Last occurrence wins (dotenv semantics), first-seen order is kept.
    entriesByKey.set(match[2]!, match[3]!.trimEnd())
  }
  return [...entriesByKey.entries()].map(([key, value]) => ({ key, value }))
}

/** True when any entry line opens a quote it never closes on that line — the
 *  dotenv multi-line-value idiom (`KEY="line1\n line2"`). Our editor is
 *  line-based, so rewriting such a file would fragment the value and orphan
 *  its continuation lines; writes refuse instead (the file stays the user's,
 *  editable in their code editor). */
export function hasMultilineQuotedValue(text: string): boolean {
  for (const line of text.split(/\r?\n/)) {
    const match = ENV_LINE_PATTERN.exec(line)
    if (!match) continue
    const value = match[3]!.trimEnd()
    const quote = value[0]
    if ((quote === '"' || quote === "'") && (value.length === 1 || !value.endsWith(quote))) {
      return true
    }
  }
  return false
}

/** Merge the DESIRED entry set into the existing file text. `entries` is the
 *  full end state: keys absent from it are removed from the file. */
export function applyEnvEntriesToText(text: string, entries: AppEnvEntry[]): string {
  const desiredByKey = new Map(entries.map((entry) => [entry.key, entry.value]))
  const writtenKeys = new Set<string>()

  const keptLines: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const match = ENV_LINE_PATTERN.exec(line)
    if (!match) {
      keptLines.push(line)
      continue
    }
    const [, prefix, key] = match
    if (!desiredByKey.has(key!)) continue // key removed — drop the line
    if (writtenKeys.has(key!)) continue // duplicate line — keep only the first
    writtenKeys.add(key!)
    keptLines.push(`${prefix}${key}=${desiredByKey.get(key!)}`)
  }

  // Trim trailing blank lines so appends don't stack gaps, then append new keys.
  while (keptLines.length > 0 && keptLines[keptLines.length - 1]!.trim() === '') {
    keptLines.pop()
  }
  for (const entry of entries) {
    if (!writtenKeys.has(entry.key)) keptLines.push(`${entry.key}=${entry.value}`)
  }

  return keptLines.length > 0 ? `${keptLines.join('\n')}\n` : ''
}
