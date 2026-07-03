import { describe, expect, it } from 'vitest'
import { deriveTitleFromBody } from './derive-title-from-body.js'

describe('deriveTitleFromBody', () => {
  it('returns the first sentence when the body has clear sentence punctuation', () => {
    expect(
      deriveTitleFromBody('Sarah Chen is head of partnerships. She prefers terse emails.'),
    ).toBe('Sarah Chen is head of partnerships.')
  })

  it('handles question marks and exclamation marks as sentence boundaries', () => {
    expect(deriveTitleFromBody('Always ask first! Then act.')).toBe('Always ask first!')
    expect(deriveTitleFromBody('Where do invoices go? They go to Cathy.')).toBe(
      'Where do invoices go?',
    )
  })

  it('falls back to the full trimmed body when there is no sentence boundary', () => {
    expect(deriveTitleFromBody('a short note no punctuation')).toBe('a short note no punctuation')
  })

  it('collapses internal whitespace + trims surrounding whitespace', () => {
    expect(deriveTitleFromBody('   tomato    supplier    list   ')).toBe('tomato supplier list')
  })

  it('truncates on a word boundary with an ellipsis when over the 120-char cap', () => {
    const longBody = 'a '.repeat(80) + 'tail' // 161 chars
    const title = deriveTitleFromBody(longBody)
    expect(title.length).toBeLessThanOrEqual(120)
    expect(title.endsWith('…')).toBe(true)
    expect(title).not.toContain('  ') // no double-space artefacts
  })

  it('returns "Untitled memory" for an empty body', () => {
    expect(deriveTitleFromBody('')).toBe('Untitled memory')
    expect(deriveTitleFromBody('   \n\t  ')).toBe('Untitled memory')
  })
})
