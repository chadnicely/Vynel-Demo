import { describe, expect, it } from 'vitest'
import { normalizeMemoryTags, MAX_TAGS_PER_ENTRY } from './memory-tags.js'

describe('normalizeMemoryTags', () => {
  it('trims, lowercases, collapses whitespace, dedupes, and drops empties', () => {
    expect(normalizeMemoryTags(['  Context ', 'CONTEXT', 'My   Project', '', '  '])).toEqual([
      'context',
      'my project',
    ])
  })

  it('returns [] for undefined or empty input', () => {
    expect(normalizeMemoryTags(undefined)).toEqual([])
    expect(normalizeMemoryTags([])).toEqual([])
  })

  it('rejects too many tags with a plain-words error', () => {
    const tags = Array.from({ length: MAX_TAGS_PER_ENTRY + 1 }, (_, i) => `tag-${i}`)
    expect(() => normalizeMemoryTags(tags)).toThrow(/at most/)
  })

  it('rejects an over-long tag', () => {
    expect(() => normalizeMemoryTags(['x'.repeat(33)])).toThrow(/too long/)
  })
})
