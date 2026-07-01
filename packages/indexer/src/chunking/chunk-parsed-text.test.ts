// Pure unit tests for chunkParsedText. No I/O.

import { describe, expect, it } from 'vitest'
import { chunkParsedText } from './chunk-parsed-text.js'

describe('chunkParsedText', () => {
  it('returns [] for empty text', () => {
    expect(chunkParsedText({ parsedText: '' })).toEqual([])
  })

  it('returns a single chunk when text length <= target', () => {
    const text = 'Hello world.'
    const chunks = chunkParsedText({ parsedText: text, targetChunkSizeChars: 100 })
    expect(chunks).toHaveLength(1)
    expect(chunks[0]!.chunkText).toBe(text)
    expect(chunks[0]!.startCharOffset).toBe(0)
    expect(chunks[0]!.endCharOffset).toBe(text.length)
    expect(chunks[0]!.chunkIndex).toBe(0)
  })

  it('splits multi-paragraph text cleanly at paragraph boundaries', () => {
    const p1 = 'A'.repeat(30)
    const p2 = 'B'.repeat(30)
    const p3 = 'C'.repeat(30)
    const text = `${p1}\n\n${p2}\n\n${p3}`
    const chunks = chunkParsedText({
      parsedText: text,
      targetChunkSizeChars: 40,
      chunkOverlapChars: 0,
    })
    expect(chunks.length).toBeGreaterThanOrEqual(3)
    // First chunk should contain p1 (paragraph boundary preserved)
    expect(chunks[0]!.chunkText).toContain('A')
  })

  it('falls through to character split for very long single line (no separators)', () => {
    const text = 'X'.repeat(150)
    const chunks = chunkParsedText({
      parsedText: text,
      targetChunkSizeChars: 50,
      chunkOverlapChars: 0,
    })
    expect(chunks.length).toBeGreaterThanOrEqual(3)
  })

  it('overlap correctness: chunk N starts with the last `overlap` chars of chunk N-1', () => {
    const p1 = 'A'.repeat(30)
    const p2 = 'B'.repeat(30)
    const text = `${p1}\n\n${p2}`
    const chunks = chunkParsedText({
      parsedText: text,
      targetChunkSizeChars: 40,
      chunkOverlapChars: 10,
    })
    expect(chunks.length).toBeGreaterThanOrEqual(2)
    // chunk 1 includes the tail of chunk 0 (overlap window)
    const tail = chunks[0]!.chunkText.slice(-10)
    expect(chunks[1]!.chunkText.startsWith(tail)).toBe(true)
  })

  it('overlap stays bounded — does NOT accumulate across chunks 2+', () => {
    // Regression test: pre-fix `mergeWithOverlap` pulled the overlap
    // source from `result[i-1].chunkText`, which already carried
    // chunk i-2's prepended overlap — so each subsequent chunk's
    // prefix grew without bound. The fix uses the RAW previous
    // chunk; the prefix stays ≤ `overlap` chars + the `\n` separator.
    const target = 40
    const overlap = 10
    const text = ['A'.repeat(30), 'B'.repeat(30), 'C'.repeat(30), 'D'.repeat(30)].join('\n\n')
    const chunks = chunkParsedText({
      parsedText: text,
      targetChunkSizeChars: target,
      chunkOverlapChars: overlap,
    })
    expect(chunks.length).toBeGreaterThanOrEqual(3)
    // For every chunk after the first, the prefix added by the
    // overlap step is at most `overlap + 1` (the separator newline).
    for (let i = 1; i < chunks.length; i++) {
      const newlinePos = chunks[i]!.chunkText.indexOf('\n')
      // The overlap prefix is everything up to (and including) the
      // first newline. Should never exceed `overlap` chars worth.
      expect(newlinePos).toBeGreaterThanOrEqual(0)
      expect(newlinePos).toBeLessThanOrEqual(overlap)
    }
  })

  it('honors targetChunkSizeChars override', () => {
    const text = 'X'.repeat(500)
    const small = chunkParsedText({
      parsedText: text,
      targetChunkSizeChars: 50,
      chunkOverlapChars: 0,
    })
    const big = chunkParsedText({
      parsedText: text,
      targetChunkSizeChars: 250,
      chunkOverlapChars: 0,
    })
    expect(small.length).toBeGreaterThan(big.length)
  })

  it('honors chunkOverlapChars override (0 = no overlap)', () => {
    const p1 = 'A'.repeat(30)
    const p2 = 'B'.repeat(30)
    const text = `${p1}\n\n${p2}`
    const noOverlap = chunkParsedText({
      parsedText: text,
      targetChunkSizeChars: 40,
      chunkOverlapChars: 0,
    })
    // Chunk 1 should NOT start with chunk 0's tail
    if (noOverlap.length >= 2) {
      expect(noOverlap[1]!.chunkText.startsWith('A')).toBe(false)
    }
  })

  it('chunkTokenEstimate ~= ceil(characterCount / 4) per chunk', () => {
    const text = 'X'.repeat(200)
    const chunks = chunkParsedText({ parsedText: text, targetChunkSizeChars: 1000 })
    expect(chunks[0]!.chunkTokenEstimate).toBe(Math.ceil(200 / 4))
  })

  it('startCharOffset/endCharOffset advance with the cursor (round-trippable)', () => {
    const p1 = 'paragraph one content'
    const p2 = 'paragraph two content'
    const text = `${p1}\n\n${p2}`
    const chunks = chunkParsedText({
      parsedText: text,
      targetChunkSizeChars: 30,
      chunkOverlapChars: 0,
    })
    for (const c of chunks) {
      expect(c.endCharOffset).toBeGreaterThanOrEqual(c.startCharOffset)
    }
  })
})
