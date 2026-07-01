// Tests for parsePlainTextDocument.

import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parsePlainTextDocument } from './parse-plain-text.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixture = path.join(__dirname, '__fixtures__', 'sample.txt')

describe('parsePlainTextDocument', () => {
  it('reads a .txt file and returns the raw text pass-through', async () => {
    const fileStat = await stat(fixture)
    const result = await parsePlainTextDocument({
      absolutePath: fixture,
      fileSizeBytes: fileStat.size,
    })
    expect(result.parsedText).toContain('Just some plain text content.')
    expect(result.parsedText).toContain('Second line.')
  })
})
