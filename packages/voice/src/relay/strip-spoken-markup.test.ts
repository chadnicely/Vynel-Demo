import { describe, expect, it } from 'vitest'
import { stripSpokenMarkup } from './strip-spoken-markup.js'

describe('stripSpokenMarkup', () => {
  it('removes emphasis so TTS never voices the asterisks', () => {
    expect(stripSpokenMarkup('I checked **London**: currently **26°C, clear skies**.')).toBe(
      'I checked London: currently 26°C, clear skies.',
    )
  })

  it('drops list markers, headings, links, and table pipes', () => {
    expect(stripSpokenMarkup('- first\n- second')).toBe('first second')
    expect(stripSpokenMarkup('## Weather')).toBe('Weather')
    expect(stripSpokenMarkup('see [the docs](https://x.io/y)')).toBe('see the docs')
    expect(stripSpokenMarkup('a | b | c')).toBe('a b c')
  })

  it('strips inline + fenced code', () => {
    expect(stripSpokenMarkup('run `npm test` now')).toBe('run npm test now')
    expect(stripSpokenMarkup('before ```code block``` after')).toBe('before after')
  })

  it('collapses an all-markup fragment to empty (the caller skips it)', () => {
    expect(stripSpokenMarkup('**')).toBe('')
    expect(stripSpokenMarkup('   ')).toBe('')
  })

  it('leaves plain speech untouched', () => {
    expect(stripSpokenMarkup('It is noon and clear.')).toBe('It is noon and clear.')
  })
})
