// Tests for parseHtmlDocument.

import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parseHtmlDocument } from './parse-html.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixture = path.join(__dirname, '__fixtures__', 'sample.html')

describe('parseHtmlDocument', () => {
  it('strips <script> + <style> tags from the parsed text', async () => {
    const fileStat = await stat(fixture)
    const result = await parseHtmlDocument({
      absolutePath: fixture,
      fileSizeBytes: fileStat.size,
    })
    expect(result.parsedText).not.toContain('alert(')
    expect(result.parsedText).not.toContain('color: red')
  })

  it('returns the body text only', async () => {
    const fileStat = await stat(fixture)
    const result = await parseHtmlDocument({
      absolutePath: fixture,
      fileSizeBytes: fileStat.size,
    })
    // html-to-text uppercases <h1> content by default — match the actual output
    expect(result.parsedText).toContain('HELLO')
    expect(result.parsedText).toContain('This is body text.')
    expect(result.parsedText).toContain('Second paragraph.')
  })
})
