// Plain text parser — pass-through.
// Per blueprint §4.2.

import { readFile } from 'node:fs/promises'
import type { ParseDocumentInput, ParseDocumentResult } from './parser-types.js'

export async function parsePlainTextDocument(
  input: ParseDocumentInput,
): Promise<ParseDocumentResult> {
  const content = await readFile(input.absolutePath, 'utf8')
  return { parsedText: content }
}
