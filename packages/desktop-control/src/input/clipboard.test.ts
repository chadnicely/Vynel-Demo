import { describe, expect, it } from 'vitest'
import { truncateClipboardText, MAX_CLIPBOARD_READ_LENGTH } from './clipboard.js'

describe('truncateClipboardText', () => {
  it('passes short content through untouched', () => {
    expect(truncateClipboardText('hello')).toEqual({
      text: 'hello',
      truncated: false,
      totalLength: 5,
    })
  })

  it('handles empty content (an empty clipboard is not an error)', () => {
    expect(truncateClipboardText('')).toEqual({ text: '', truncated: false, totalLength: 0 })
  })

  it('cuts over-long content AND says how much there was', () => {
    // Silence would read as "that is all of it" — which is how a model concludes
    // it copied a whole document when it only saw a prefix.
    const long = 'x'.repeat(MAX_CLIPBOARD_READ_LENGTH + 500)
    const result = truncateClipboardText(long)
    expect(result.truncated).toBe(true)
    expect(result.text).toHaveLength(MAX_CLIPBOARD_READ_LENGTH)
    expect(result.totalLength).toBe(MAX_CLIPBOARD_READ_LENGTH + 500)
  })

  it('does not truncate content exactly at the limit', () => {
    const exact = 'y'.repeat(MAX_CLIPBOARD_READ_LENGTH)
    expect(truncateClipboardText(exact).truncated).toBe(false)
  })
})
