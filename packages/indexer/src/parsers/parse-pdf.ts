// PDF parser via `pdf-parse`. Handles text PDFs; scanned PDFs
// return empty parsedText (document marked `parsed` with
// chunkCount=0; no error). OCR is out of scope for Phase 1.
// Per blueprint §4.3.

import { readFile } from 'node:fs/promises'
import pdf from 'pdf-parse'
import type { ParseDocumentInput, ParseDocumentResult } from './parser-types.js'

export async function parsePdfDocument(input: ParseDocumentInput): Promise<ParseDocumentResult> {
  const buffer = await readFile(input.absolutePath)
  const result = await pdf(buffer)
  return { parsedText: result.text, pageCount: result.numpages }
}
