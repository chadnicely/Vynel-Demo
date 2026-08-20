import { describe, it, expect } from 'vitest'
import { loadSessionInstruction } from './load-session-instruction.js'
import { renderTurnTimeMarker } from './render-turn-time-marker.js'

// 2026-08-21T09:51:00Z — 02:51 in Los Angeles, 18:51 in Tokyo (the next day).
const INSTANT = new Date('2026-08-21T09:51:00.000Z')

describe('turn-time-marker', () => {
  it('is ONE line and declares both placeholders', () => {
    const raw = loadSessionInstruction('turn-time-marker')
    expect(raw).toContain('{{nowLocal}}')
    expect(raw).toContain('{{timezone}}')
    expect(raw.trim().split('\n')).toHaveLength(1)
  })

  it("tells the model to work relative times from THIS clock, never guess", () => {
    const raw = loadSessionInstruction('turn-time-marker')
    expect(raw).toContain('in 15 minutes')
    expect(raw).toMatch(/never guess/i)
  })

  it('renders the wall clock IN THE GIVEN ZONE, weekday and all, and names the zone', () => {
    const marker = renderTurnTimeMarker(INSTANT, 'America/Los_Angeles')
    expect(marker).toContain('Friday, August 21, 2026')
    expect(marker).toContain('2:51 AM')
    expect(marker).toContain('America/Los_Angeles')
    expect(marker).not.toContain('{{')
  })

  it('is the SAME instant read in another zone — the zone decides the date too', () => {
    const marker = renderTurnTimeMarker(INSTANT, 'Asia/Tokyo')
    expect(marker).toContain('Friday, August 21, 2026')
    expect(marker).toContain('6:51 PM')
    expect(marker).toContain('Asia/Tokyo')
  })

  it('falls back to the ISO instant on an unusable zone rather than someone else’s local time', () => {
    const marker = renderTurnTimeMarker(INSTANT, 'Mars/Olympus_Mons')
    expect(marker).toContain('2026-08-21T09:51:00.000Z')
    expect(marker).not.toContain('{{')
  })
})
