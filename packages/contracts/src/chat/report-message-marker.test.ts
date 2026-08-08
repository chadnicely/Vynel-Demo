import { describe, expect, it } from 'vitest'
import {
  composeDirectMessageMarker,
  composeReportMessageMarker,
  composeUpdateMessageMarker,
  isDirectMessageBody,
  isUpdateMessageBody,
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

  it('the UPDATE marker (persona-sessions) round-trips through the same strip and says the task is running', () => {
    const body = 'Received — starting on the schema now.'
    const marked = `${composeUpdateMessageMarker('Nova')}\n\n${body}`
    expect(stripReportMessageMarker(marked)).toBe(body)
    expect(composeUpdateMessageMarker('Nova')).toContain('Nova')
    expect(composeUpdateMessageMarker('Nova')).toContain('STILL RUNNING')
  })

  it('isUpdateMessageBody tells the interim update from the final report (the badge split)', () => {
    expect(isUpdateMessageBody(`${composeUpdateMessageMarker('Nova')}\n\nReceived.`)).toBe(true)
    expect(isUpdateMessageBody(`${composeReportMessageMarker('Nova')}\n\nDone.`)).toBe(false)
    expect(isUpdateMessageBody('A plain message.')).toBe(false)
  })

  it('the DIRECT marker (kind direct_to_user) round-trips and discriminates from both siblings', () => {
    const body = 'Overview of the agency app\n\nNuxt 4 + Vue 3; seven Pinia stores.'
    const marked = `${composeDirectMessageMarker('James · Claw Launcher')}\n\n${body}`
    expect(marked.startsWith('[Message from James · Claw Launcher')).toBe(true)
    expect(stripReportMessageMarker(marked)).toBe(body)
    expect(isDirectMessageBody(marked)).toBe(true)
    expect(isUpdateMessageBody(marked)).toBe(false)
    expect(isDirectMessageBody(`${composeReportMessageMarker('Nova')}\n\nDone.`)).toBe(false)
    expect(isDirectMessageBody('A plain message.')).toBe(false)
  })
})
