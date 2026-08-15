// The reference line on a message that points AT an earlier turn.
//
// WHY: marking a turn in the thread pins it, and the next message opens with
// this line so the model knows which exchange "that one" means. It is written
// FOR THE MODEL — the person already saw what they marked, in the composer's
// chip and in the card itself — so the thread STRIPS it for display, exactly
// as a delivered report strips its attribution marker. One home for both ends
// so the composer and the renderer cannot drift.

const REFERENCE_PREFIX = '> Re: '

export function composeTurnReferenceLine(
  author: string,
  time: string,
  preview: string,
): string {
  return `${REFERENCE_PREFIX}${author}${time ? ` · ${time}` : ''} — "${preview}"`
}

/** Drops the reference line (and its trailing blank) from a body for display.
 *  Anything else passes through untouched — including a message whose PROSE
 *  quotes "> Re:" later on.
 *
 *  The line is by construction ONE line ending in the closing quote of the
 *  preview, so a person's own blockquote that happens to start "> Re: " stays
 *  put unless it also ends that way. Same shape as the report marker's `]`
 *  test, and for the same reason: never a substring hunt. */
export function stripTurnReferenceLine(body: string): string {
  if (!body.startsWith(REFERENCE_PREFIX)) return body
  const lineEnd = body.indexOf('\n')
  const firstLine = lineEnd === -1 ? body : body.slice(0, lineEnd)
  if (!firstLine.trimEnd().endsWith('"')) return body
  if (lineEnd === -1) return ''
  return body.slice(lineEnd + 1).replace(/^\n/, '')
}
