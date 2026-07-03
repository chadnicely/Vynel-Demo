// Split an accumulating stdout buffer into complete NDJSON lines plus the
// trailing incomplete remainder. The listener feeds each chunk in, ingests the
// complete lines, and carries `rest` forward until the next newline arrives so
// a notification split across two reads is never half-parsed. (`\r` from
// Windows CRLF survives here and is stripped downstream by the line parser.)
export function takeCompleteLines(buffer: string): { lines: string[]; rest: string } {
  const segments = buffer.split('\n')
  const rest = segments.pop() ?? ''
  return { lines: segments, rest }
}
