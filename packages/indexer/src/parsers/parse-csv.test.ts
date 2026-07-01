// Tests for parseCsvDocument.

import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parseCsvDocument } from './parse-csv.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixture = path.join(__dirname, '__fixtures__', 'sample.csv')

describe('parseCsvDocument', () => {
  it('renders rows as labeled text blocks with the columns header', async () => {
    const fileStat = await stat(fixture)
    const result = await parseCsvDocument({
      absolutePath: fixture,
      fileSizeBytes: fileStat.size,
    })
    expect(result.parsedText).toContain('Columns: name, email, role')
    expect(result.parsedText).toContain('name: Alice')
    expect(result.parsedText).toContain('email: bob@acme.com')
  })

  it('skips empty values per cell', async () => {
    const fileStat = await stat(fixture)
    const result = await parseCsvDocument({
      absolutePath: fixture,
      fileSizeBytes: fileStat.size,
    })
    // The 3rd row has empty name + role; only email should appear for that row
    const lines = result.parsedText.split('\n')
    const emptyRow = lines.find((l) => l.includes('empty@acme.com'))
    expect(emptyRow).toBeDefined()
    expect(emptyRow).not.toContain('name:')
    expect(emptyRow).not.toContain('role:')
  })
})
