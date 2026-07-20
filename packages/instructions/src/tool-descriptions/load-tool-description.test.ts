import { describe, it, expect } from 'vitest'
import { loadToolDescription, type ToolDescriptionId } from './load-tool-description.js'

describe('loadToolDescription', () => {
  it('speak teaches spoken-style prose and the spoken:false fallback', () => {
    const description = loadToolDescription('speak')
    expect(description).toContain('ALOUD')
    expect(description).toContain('NO markdown')
    expect(description).toContain('spoken: false')
  })

  it('fails loudly for an id with no backing markdown file', () => {
    expect(() => loadToolDescription('does-not-exist' as ToolDescriptionId)).toThrow(
      /could not be read/,
    )
  })
})
