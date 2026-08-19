import { describe, expect, it } from 'vitest'
import { decideCallUtterance, detectAddressed } from './call-turn-policy.js'

const NAME = 'Vynel'

describe('detectAddressed', () => {
  it('matches the name anywhere in the utterance, case-insensitively', () => {
    expect(detectAddressed(NAME, 'Vynel, can you pull up the numbers?')).toBe(true)
    expect(detectAddressed(NAME, 'what do you think, vynel?')).toBe(true)
    expect(detectAddressed(NAME, 'let us ask VYNEL about that')).toBe(true)
  })

  it('requires a word boundary — a name embedded in another word is not an address', () => {
    expect(detectAddressed(NAME, 'the vynelish approach works')).toBe(false)
    expect(detectAddressed(NAME, 'we discussed the roadmap')).toBe(false)
  })

  it('escapes regex metacharacters in configured names', () => {
    expect(detectAddressed('C-3PO?', 'hey C-3PO? are you there')).toBe(true)
    expect(detectAddressed('C-3PO?', 'hey C-3PO are you there')).toBe(false)
  })

  it('treats accented letters as word characters — no substring leak', () => {
    expect(detectAddressed('José', 'José, ¿puedes ayudar?')).toBe(true)
    expect(detectAddressed('José', 'Josée is presenting next')).toBe(false)
  })
})

describe('decideCallUtterance', () => {
  it('ignores silence and noise in every mode', () => {
    expect(decideCallUtterance('notetaker', '   ', NAME)).toEqual({ kind: 'ignore' })
    expect(decideCallUtterance('participant', '', NAME)).toEqual({ kind: 'ignore' })
  })

  it('participant mode: every real utterance gets a response', () => {
    expect(decideCallUtterance('participant', 'so what is the deploy status?', NAME)).toEqual({
      kind: 'respond',
    })
  })

  it('notetaker mode: name-addressed utterances respond, the rest become notes', () => {
    expect(decideCallUtterance('notetaker', 'Vynel, summarize the last point', NAME)).toEqual({
      kind: 'respond',
    })
    expect(decideCallUtterance('notetaker', 'the Q3 numbers came in above plan', NAME)).toEqual({
      kind: 'note',
    })
  })

  it('an echo of a recently spoken line is ignored in both modes', () => {
    const lines = ['Got it. Anything else you want to talk about?']
    expect(decideCallUtterance('participant', 'Got it', NAME, lines)).toEqual({ kind: 'ignore' })
    expect(decideCallUtterance('notetaker', 'Got it', NAME, lines)).toEqual({ kind: 'ignore' })
    expect(decideCallUtterance('participant', 'and what about the deadline?', NAME, lines)).toEqual({
      kind: 'respond',
    })
  })
})
