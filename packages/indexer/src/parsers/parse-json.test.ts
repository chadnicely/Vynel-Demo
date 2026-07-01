// Tests for parseJsonDocument.

import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parseJsonDocument } from './parse-json.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const validFixture = path.join(__dirname, '__fixtures__', 'sample.json')
const malformedFixture = path.join(__dirname, '__fixtures__', 'malformed.json')

describe('parseJsonDocument', () => {
  it('round-trips well-formed JSON via JSON.parse + JSON.stringify', async () => {
    const fileStat = await stat(validFixture)
    const result = await parseJsonDocument({
      absolutePath: validFixture,
      fileSizeBytes: fileStat.size,
    })
    // Pretty-printed with 2-space indent
    expect(result.parsedText).toContain('"name": "sample"')
    expect(result.parsedText).toContain('"items"')
    // Confirm valid JSON in/out
    expect(() => JSON.parse(result.parsedText)).not.toThrow()
  })

  it('preserves raw text for malformed JSON (no throw)', async () => {
    const fileStat = await stat(malformedFixture)
    const result = await parseJsonDocument({
      absolutePath: malformedFixture,
      fileSizeBytes: fileStat.size,
    })
    // Should not throw; should preserve raw text
    expect(result.parsedText).toContain('broken')
  })
})
