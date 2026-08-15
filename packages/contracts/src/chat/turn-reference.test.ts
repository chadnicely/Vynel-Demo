import { describe, expect, it } from 'vitest'
import {
  composeTurnReferenceLine,
  stripTurnReferenceLine,
} from './turn-reference.js'

describe('turn reference line', () => {
  it('composes the line the model reads', () => {
    expect(composeTurnReferenceLine('You', 'Aug 14 · 10:22 AM', 'Use desktop tools')).toBe(
      '> Re: You · Aug 14 · 10:22 AM — "Use desktop tools"',
    )
  })

  it('drops the time segment when there is none', () => {
    expect(composeTurnReferenceLine('You', '', 'Use desktop tools')).toBe(
      '> Re: You — "Use desktop tools"',
    )
  })

  // The bug this pins: an unstripped line became the folded card's preview,
  // so a referenced ask read "Re: You · …" and the question itself vanished.
  it('strips the line and its blank, leaving the real message', () => {
    const line = composeTurnReferenceLine('You', 'Aug 14 · 10:22 AM', 'Use desktop tools')
    expect(stripTurnReferenceLine(`${line}\n\nrun it again`)).toBe('run it again')
  })

  it('leaves an ordinary message alone', () => {
    expect(stripTurnReferenceLine('run it again')).toBe('run it again')
    expect(stripTurnReferenceLine('Re: the thing you said')).toBe('Re: the thing you said')
  })

  // A person's own blockquote is not our marker unless it closes like one.
  it("leaves a person's own quote alone", () => {
    const quoted = '> Re: what you asked about the deploy\n\nstill broken'
    expect(stripTurnReferenceLine(quoted)).toBe(quoted)
  })

  it('quoting the marker later in the prose is untouched', () => {
    const body = 'here is what it looks like:\n\n> Re: You — "x"'
    expect(stripTurnReferenceLine(body)).toBe(body)
  })

  it('a bare reference with no message strips to nothing', () => {
    expect(stripTurnReferenceLine('> Re: You — "x"')).toBe('')
  })

  // Observed in the wild: marking a status-change turn gives an EMPTY preview
  // (a status change carries no chat body), so the line ends `— ""`. That is
  // still the marker and still strips.
  it('strips a reference whose preview came out empty', () => {
    expect(
      stripTurnReferenceLine('> Re: Ryan · Aug 14 · 10:22 AM — ""\n\nWhat was connected as ref?'),
    ).toBe('What was connected as ref?')
  })
})
