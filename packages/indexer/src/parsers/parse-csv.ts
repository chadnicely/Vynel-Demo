// CSV parser via `papaparse`. Renders rows as labeled text blocks
// for embedding ("Columns: a, b, c" + "a: value; b: value; ...").
// Per blueprint §4.6.

import { readFile } from 'node:fs/promises'
import Papa from 'papaparse'
import type { ParseDocumentInput, ParseDocumentResult } from './parser-types.js'

export async function parseCsvDocument(input: ParseDocumentInput): Promise<ParseDocumentResult> {
  const content = await readFile(input.absolutePath, 'utf8')
  const parsed = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
  })

  const lines: string[] = []
  if (parsed.meta.fields && parsed.meta.fields.length > 0) {
    lines.push(`Columns: ${parsed.meta.fields.join(', ')}`)
  }
  for (const row of parsed.data) {
    const entries = Object.entries(row)
      .filter(([, v]) => v && v.trim().length > 0)
      .map(([k, v]) => `${k}: ${v}`)
      .join('; ')
    if (entries.length > 0) lines.push(entries)
  }
  return { parsedText: lines.join('\n') }
}
