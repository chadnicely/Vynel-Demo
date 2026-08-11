import { describe, expect, it } from 'vitest'
import {
  parseBoundsEcho,
  rejectUnusableBounds,
  MIN_WINDOW_EDGE_PX,
} from './window-bounds.js'

describe('rejectUnusableBounds', () => {
  it('accepts a normal rectangle', () => {
    expect(rejectUnusableBounds({ x: 100, y: 100, width: 800, height: 600 })).toBeNull()
  })

  // The trap Guide §15.4 names: a display left of or above the primary lives at
  // negative coordinates, and rejecting them makes the second monitor
  // unreachable. Verified live — a window placed at (-1000,-800) lands on the
  // portrait panel exactly.
  it('ACCEPTS negative coordinates — that is the second monitor, not an error', () => {
    expect(rejectUnusableBounds({ x: -1000, y: -800, width: 640, height: 480 })).toBeNull()
    expect(rejectUnusableBounds({ x: -1080, y: -847, width: 864, height: 1536 })).toBeNull()
  })

  it('refuses a window too small to grab back', () => {
    const tooSmall = rejectUnusableBounds({ x: 0, y: 0, width: 10, height: 600 })
    expect(tooSmall).toMatch(new RegExp(String(MIN_WINDOW_EDGE_PX)))
    expect(rejectUnusableBounds({ x: 0, y: 0, width: 600, height: 4 })).not.toBeNull()
  })

  it('refuses non-finite numbers before any window is touched', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(rejectUnusableBounds({ x: bad, y: 0, width: 800, height: 600 })).not.toBeNull()
      expect(rejectUnusableBounds({ x: 0, y: 0, width: bad, height: 600 })).not.toBeNull()
    }
  })
})

describe('parseBoundsEcho', () => {
  it('reads back the rectangle the window actually ended at', () => {
    expect(parseBoundsEcho('-1000,-800,640,480\n')).toEqual({
      ok: true,
      applied: { x: -1000, y: -800, width: 640, height: 480 },
    })
  })

  it('takes the LAST line — PowerShell may print warnings first', () => {
    expect(parseBoundsEcho('WARNING: something\n300,250,640,480')).toEqual({
      ok: true,
      applied: { x: 300, y: 250, width: 640, height: 480 },
    })
  })

  it('reports the no-window case distinctly — it has its own recovery', () => {
    // A tray-minimized app has no main window handle; the caller turns this
    // into "use launch_app first" rather than a generic failure.
    expect(parseBoundsEcho('NOWINDOW')).toEqual({ ok: false, reason: 'no-window' })
  })

  it('fails rather than inventing a rectangle from garbage', () => {
    for (const junk of ['', 'nonsense', '1,2,3', '1,2,3,four']) {
      expect(parseBoundsEcho(junk)).toEqual({ ok: false, reason: 'failed' })
    }
  })
})
