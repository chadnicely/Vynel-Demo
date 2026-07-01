// Tests for parseMarkdownDocument. Real fixture `.md` file in
// `__fixtures__/`.

import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parseMarkdownDocument } from './parse-markdown.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixture = path.join(__dirname, '__fixtures__', 'sample.md')

describe('parseMarkdownDocument', () => {
  it('reads a markdown file and returns the raw text pass-through', async () => {
    const fileStat = await stat(fixture)
    const result = await parseMarkdownDocument({
      absolutePath: fixture,
      fileSizeBytes: fileStat.size,
    })
    expect(result.parsedText).toContain('# Sample Markdown')
  })

  it('preserves heading + paragraph + code block characters', async () => {
    const fileStat = await stat(fixture)
    const result = await parseMarkdownDocument({
      absolutePath: fixture,
      fileSizeBytes: fileStat.size,
    })
    expect(result.parsedText).toContain('## A Heading')
    expect(result.parsedText).toContain('inline code')
    expect(result.parsedText).toContain('const x = 42')
  })

  it('returns parsedText with no metadata (no pageCount; no sheetCount)', async () => {
    const fileStat = await stat(fixture)
    const result = await parseMarkdownDocument({
      absolutePath: fixture,
      fileSizeBytes: fileStat.size,
    })
    expect(result.pageCount).toBeUndefined()
    expect(result.sheetCount).toBeUndefined()
  })
})
