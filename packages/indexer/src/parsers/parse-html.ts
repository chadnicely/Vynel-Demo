// HTML parser via `html-to-text`. Strips `<script>` + `<style>`
// content; returns the body text.
// Per blueprint §4.5.

import { readFile } from 'node:fs/promises'
import { htmlToText } from 'html-to-text'
import type { ParseDocumentInput, ParseDocumentResult } from './parser-types.js'

export async function parseHtmlDocument(input: ParseDocumentInput): Promise<ParseDocumentResult> {
  const raw = await readFile(input.absolutePath, 'utf8')
  const text = htmlToText(raw, {
    wordwrap: false,
    selectors: [
      { selector: 'script', format: 'skip' },
      { selector: 'style', format: 'skip' },
    ],
  })
  return { parsedText: text }
}
