import { describe, expect, it } from 'vitest'
import {
  composeReportMessageMarker,
  stripReportMessageMarker,
} from './report-message-marker.js'

describe('report message marker', () => {
  it('round-trips: strip removes exactly what compose prepended', () => {
    const body = '**Done.** All seven sections are grounded in code.'
    const marked = `${composeReportMessageMarker('Sarah · letterman')}\n\n${body}`
    expect(stripReportMessageMarker(marked)).toBe(body)
  })

  it('names the reporter so the model knows WHO the result is from', () => {
    expect(composeReportMessageMarker('Sarah · letterman')).toContain('Sarah · letterman')
  })

  it("survives a ']' inside the label — user-chosen workspace names may contain brackets", () => {
    const body = 'All phases are on track.'
    const marked = `${composeReportMessageMarker('Mark · Q3 [phase 2]')}\n\n${body}`
    expect(stripReportMessageMarker(marked)).toBe(body)
  })

  it('passes ordinary bodies through untouched — even ones mentioning the marker mid-prose', () => {
    expect(stripReportMessageMarker('A plain user message.')).toBe('A plain user message.')
    const prose = 'See the earlier [Report from Sarah] message for context.'
    // Starts with ordinary text — untouched.
    expect(stripReportMessageMarker(`Note: ${prose}`)).toBe(`Note: ${prose}`)
  })
})
