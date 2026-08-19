// Guards for the schedule-fire marker + its render step (the one templated
// session instruction). The frame is what stops a fired prompt reading as the
// user typing (the 2026-08-20 "Tea" bug: AskUserQuestion + a `sleep` timer) —
// these fail loudly if an edit drops the attribution, the deliver-now rule, or
// a placeholder the renderer fills.

import { describe, expect, it } from 'vitest'
import { loadSessionInstruction } from './load-session-instruction.js'
import { renderScheduleFireMarker } from './render-schedule-fire-marker.js'

describe('schedule-fire-marker', () => {
  it('the raw instruction carries both placeholders and stays one line (the per-message marker shape)', () => {
    const raw = loadSessionInstruction('schedule-fire-marker')
    expect(raw).toContain('{{scheduleName}}')
    expect(raw).toContain('{{firedAtLocal}}')
    expect(raw.trim().split('\n')).toHaveLength(1)
  })

  it('states the frame: the scheduler speaking, NOT the user; deliver now; no timer, no sleep, no asking back', () => {
    const raw = loadSessionInstruction('schedule-fire-marker')
    expect(raw).toContain("Vynel's scheduler")
    expect(raw).toContain('NOT the user typing')
    expect(raw).toContain('deliver it now')
    expect(raw).toContain('never create a timer')
    expect(raw).toContain('never sleep')
    expect(raw).toContain('never ask them what they meant')
  })

  it('renderScheduleFireMarker fills the name + the local fire time, leaving no placeholder behind', () => {
    const marker = renderScheduleFireMarker({
      scheduleDisplayName: 'Tea',
      firedAtLocal: 'Aug 20, 2026, 2:00 PM',
    })
    expect(marker).toContain('firing the schedule "Tea" now (Aug 20, 2026, 2:00 PM)')
    expect(marker).not.toContain('{{')
    expect(marker).not.toContain('}}')
  })
})
