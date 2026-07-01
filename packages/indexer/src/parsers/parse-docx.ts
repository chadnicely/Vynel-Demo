// DOCX parser via `mammoth.extractRawText`. Text-only; tables,
// images, headers, footers, comments are dropped (acceptable
// for Phase 1 — text search is the goal).
// Per blueprint §4.4.

import mammoth from 'mammoth'
import type { ParseDocumentInput, ParseDocumentResult } from './parser-types.js'

export async function parseDocxDocument(input: ParseDocumentInput): Promise<ParseDocumentResult> {
  const result = await mammoth.extractRawText({ path: input.absolutePath })
  return { parsedText: result.value }
}
