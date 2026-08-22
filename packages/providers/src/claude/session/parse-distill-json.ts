// `parseDistillJson` — the one home for reading a JSON object out of a
// distill turn's text. A one-shot model reply is ALMOST json: it may arrive
// fenced, or with a stray sentence around the object. We take the outermost
// `{…}` span and parse that; anything unparseable is null (the caller falls
// back), never a throw — a failed distill must cost the user nothing.

export function parseDistillJson(text: string | null): unknown {
  if (text === null) return null
  const opensAt = text.indexOf('{')
  const closesAt = text.lastIndexOf('}')
  if (opensAt < 0 || closesAt <= opensAt) return null
  try {
    return JSON.parse(text.slice(opensAt, closesAt + 1))
  } catch {
    return null
  }
}

/** Reads `value[key]` as an array — `[]` for a missing key, a non-array, or
 *  a non-object — so every shaped reader starts from the same guard. */
export function readList(value: unknown, key: string): unknown[] {
  if (typeof value !== 'object' || value === null) return []
  const list = (value as Record<string, unknown>)[key]
  return Array.isArray(list) ? list : []
}

/** Reads `value[key]` as a trimmed non-empty-string array, dropping junk
 *  entries — model lists are right in shape far more often than in every
 *  member, so we keep the good lines instead of rejecting the lot. */
export function readStringList(value: unknown, key: string): string[] {
  return readList(value, key)
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

export function readString(value: unknown, key: string): string {
  if (typeof value !== 'object' || value === null) return ''
  const field = (value as Record<string, unknown>)[key]
  return typeof field === 'string' ? field.trim() : ''
}
