// `deriveTitleFromBody` — pure. Derives a panel-list title from a
// memory entry's body when the caller didn't supply one. First
// sentence (split on `. ` / `! ` / `? `) or first line, truncated to
// MAX_TITLE_CHARS. Trims surrounding whitespace + collapses internal
// runs.

const MAX_TITLE_CHARS = 120
const ELLIPSIS = '…'

export function deriveTitleFromBody(body: string): string {
  const trimmed = body.trim().replace(/\s+/g, ' ')
  if (trimmed.length === 0) return 'Untitled memory'

  // Prefer the first sentence boundary — `.`/`!`/`?` followed by space
  // or end-of-string. Carries the punctuation into the title.
  const sentenceMatch = trimmed.match(/^.+?[.!?](?:\s|$)/)
  const firstSentence = sentenceMatch ? sentenceMatch[0].trim() : trimmed

  if (firstSentence.length <= MAX_TITLE_CHARS) return firstSentence
  // Truncate on a word boundary when possible.
  const truncated = firstSentence.slice(0, MAX_TITLE_CHARS - 1)
  const lastSpace = truncated.lastIndexOf(' ')
  const safeBreak = lastSpace > MAX_TITLE_CHARS * 0.5 ? truncated.slice(0, lastSpace) : truncated
  return safeBreak.trimEnd() + ELLIPSIS
}
