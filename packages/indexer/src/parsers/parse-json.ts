// JSON parser — well-formed: round-trip via JSON.parse +
// JSON.stringify(parsed, null, 2). Malformed: preserve raw text so
// something is searchable.
// Per blueprint §4.2.

import { readFile } from 'node:fs/promises'
import type { ParseDocumentInput, ParseDocumentResult } from './parser-types.js'

export async function parseJsonDocument(input: ParseDocumentInput): Promise<ParseDocumentResult> {
  const raw = await readFile(input.absolutePath, 'utf8')
  try {
    const parsed: unknown = JSON.parse(raw)
    return { parsedText: JSON.stringify(parsed, null, 2) }
  } catch {
    return { parsedText: raw }
  }
}
