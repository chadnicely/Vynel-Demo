import { describe, expect, it } from 'vitest'
import {
  parseBoundsEcho,
  rejectUnusableBounds,
  setWindowBounds,
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

// Now reachable because the runner is injectable (matching setWindowState) —
// previously only the two pure helpers could be tested.
describe('setWindowBounds', () => {
  const rect = { x: 100, y: 100, width: 800, height: 600 }

  it('passes the pid and all four numbers into the script', async () => {
    let script = ''
    await setWindowBounds(4242, { x: -1080, y: -847, width: 1080, height: 1920 }, async (cmd) => {
      script = cmd
      return '-1080,-847,1080,1920'
    })
    expect(script).toContain('Get-Process -Id 4242')
    expect(script).toContain('-1080, -847, 1080, 1920')
  })

  it('declares per-monitor DPI awareness BEFORE moving anything', async () => {
    // Without it Windows virtualizes coordinates on a scaled display and the
    // window lands somewhere else entirely.
    let script = ''
    await setWindowBounds(1, rect, async (cmd) => {
      script = cmd
      return '100,100,800,600'
    })
    // Compare the CALLS, not the P/Invoke declarations — every method is named
    // once in the Add-Type block first, so a bare indexOf finds the wrong one.
    expect(script.indexOf('::SetProcessDpiAwareness(2)')).toBeGreaterThan(-1)
    expect(script.indexOf('::SetProcessDpiAwareness(2)')).toBeLessThan(
      script.indexOf('::SetWindowPos($h'),
    )
  })

  it('reports the rectangle the window actually took', async () => {
    const outcome = await setWindowBounds(1, rect, async () => '100,100,500,400')
    expect(outcome).toEqual({ ok: true, applied: { x: 100, y: 100, width: 500, height: 400 } })
  })

  it('a wedged or missing PowerShell is a failed move, not a crash', async () => {
    // runPowerShell returns '' on any failure; that must not become a rectangle.
    expect(await setWindowBounds(1, rect, async () => '')).toEqual({ ok: false, reason: 'failed' })
  })

  it('surfaces the no-window case for its own recovery', async () => {
    expect(await setWindowBounds(1, rect, async () => 'NOWINDOW')).toEqual({
      ok: false,
      reason: 'no-window',
    })
  })

  // A zeroed rect is what GetWindowRect leaves behind when it fails. Reporting
  // it as success would tell the model "the app adjusted your request to 0x0".
  it('refuses a 0x0 read-back instead of calling it an adjusted size', async () => {
    expect(await setWindowBounds(1, rect, async () => '0,0,0,0')).toEqual({
      ok: false,
      reason: 'failed',
    })
  })

  it('applies the rect TWICE — the cross-DPI re-assert', async () => {
    // Measured live: a 1200x800 request leaving a 125% monitor landed at
    // 960x640 (exactly 1/1.25) because the app rescaled itself on
    // WM_DPICHANGED. The second SetWindowPos, issued once the window is ON the
    // target monitor, restores the asked size; same-monitor moves just
    // re-apply the same rect. Dropping the second call re-opens the shrink.
    let command = ''
    await setWindowBounds(1, rect, async (script) => {
      command = script
      return '10,20,300,200'
    })
    expect(command.match(/SetWindowPos\(\$h/g)).toHaveLength(2)
  })
})
