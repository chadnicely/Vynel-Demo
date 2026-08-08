import { describe, it, expect, vi } from 'vitest'
import { translatePoint, actOnDesktop, type DesktopInputProbes } from './desktop-input.js'
import type { DesktopAccessTier } from '../access/desktop-access-tiers.js'

describe('translatePoint', () => {
  it('returns absolute coordinates unchanged with a zero frame', () => {
    expect(translatePoint({ offsetX: 0, offsetY: 0 }, 120, 340)).toEqual({ x: 120, y: 340 })
  })

  it('adds the window origin for window-relative coordinates', () => {
    // A screenshot-relative (10, 20) inside a window at (1600, 300) → screen coords.
    expect(translatePoint({ offsetX: 1600, offsetY: 300 }, 10, 20)).toEqual({ x: 1610, y: 320 })
  })

  it('rounds fractional coordinates (pixels are integers)', () => {
    expect(translatePoint({ offsetX: 0.4, offsetY: 0 }, 10.6, 5.5)).toEqual({ x: 11, y: 6 })
  })

  it('divides by the screenshot downscale factor BEFORE adding the window origin', () => {
    // A 1920×1200 window screenshots at 2/3 scale; a click at (640, 400) on
    // that image is (960, 600) in the window, at (1000, 700) on screen.
    expect(translatePoint({ offsetX: 40, offsetY: 100, scale: 2 / 3 }, 640, 400)).toEqual({
      x: 1000,
      y: 700,
    })
  })
})

// These guards run BEFORE nut.js loads (validation happens before the engine is
// touched), so they exercise the fail-closed paths with no native binary — the
// same pattern as actOnApp's guard tests.
describe('actOnDesktop — fail-closed validation (before the input engine loads)', () => {
  it('rejects a click with missing coordinates', async () => {
    await expect(actOnDesktop({ action: 'click', x: 10 })).rejects.toThrow(/requires a numeric "y"/)
    await expect(actOnDesktop({ action: 'click' })).rejects.toThrow(/requires a numeric "x"/)
  })

  it('rejects a type with no text', async () => {
    await expect(actOnDesktop({ action: 'type' })).rejects.toThrow(/requires a non-empty "text"/)
    await expect(actOnDesktop({ action: 'type', text: '' })).rejects.toThrow(/non-empty "text"/)
  })

  it('rejects a press with no keys', async () => {
    await expect(actOnDesktop({ action: 'press' })).rejects.toThrow(/requires "keys"/)
  })

  it('rejects a drag missing a target', async () => {
    await expect(actOnDesktop({ action: 'drag', x: 1, y: 2, toX: 3 })).rejects.toThrow(
      /requires a numeric "toY"/,
    )
  })
})

// The enforcement seam, with injected probes — authorization runs BEFORE the
// input engine loads, so every deny/fail-closed branch is drivable with no
// native binary. The DENIAL sentinel doubles as proof `authorize` was called
// with the expected target.
describe('actOnDesktop — access enforcement (injected probes)', () => {
  // A Notepad window at (1000, 500), 800×600, screenshot scale 1.
  const notepadProbes: DesktopInputProbes = {
    resolveTargetFrame: () => ({
      frame: { offsetX: 1000, offsetY: 500, scale: 1 },
      appName: 'Notepad',
      bounds: { x: 1000, y: 500, width: 800, height: 600 },
    }),
    windowAppNameAt: () => 'Notepad',
    focusedWindowAppName: () => 'Notepad',
  }
  function recordingAuthorize(calls: Array<[string, DesktopAccessTier]>) {
    return (appName: string, required: DesktopAccessTier): void => {
      calls.push([appName, required])
      throw new Error(`DENIED:${appName}:${required}`)
    }
  }

  it('CONFINES window-relative coordinates: a point outside the named window refuses before any hit-test', async () => {
    const calls: Array<[string, DesktopAccessTier]> = []
    await expect(
      actOnDesktop(
        { action: 'click', app: 'Notepad', x: 5000, y: 5000 },
        recordingAuthorize(calls),
        notepadProbes,
      ),
    ).rejects.toThrow(/OUTSIDE the "Notepad" window/)
    expect(calls).toEqual([])
  })

  it('authorizes the HIT-TESTED app under the point, not the named frame (overlap wall)', async () => {
    // An always-on-top other app covers the point inside Notepad's rectangle.
    const probes: DesktopInputProbes = { ...notepadProbes, windowAppNameAt: () => 'PasswordSafe' }
    const calls: Array<[string, DesktopAccessTier]> = []
    await expect(
      actOnDesktop({ action: 'click', app: 'Notepad', x: 10, y: 10 }, recordingAuthorize(calls), probes),
    ).rejects.toThrow('DENIED:PasswordSafe:click')
    expect(calls).toEqual([['PasswordSafe', 'click']])
  })

  it('falls back to the named frame identity when the hit-test cannot see the point', async () => {
    const probes: DesktopInputProbes = { ...notepadProbes, windowAppNameAt: () => null }
    const calls: Array<[string, DesktopAccessTier]> = []
    await expect(
      actOnDesktop({ action: 'click', app: 'Notepad', x: 10, y: 10 }, recordingAuthorize(calls), probes),
    ).rejects.toThrow('DENIED:Notepad:click')
  })

  it('fails CLOSED on an absolute click into the void (no window, no frame)', async () => {
    const probes: DesktopInputProbes = {
      ...notepadProbes,
      resolveTargetFrame: () => ({ frame: { offsetX: 0, offsetY: 0 }, appName: null, bounds: null }),
      windowAppNameAt: () => null,
    }
    const authorize = vi.fn()
    await expect(
      actOnDesktop({ action: 'click', x: 10, y: 10 }, authorize, probes),
    ).rejects.toThrow(/Could not identify the app/)
    expect(authorize).not.toHaveBeenCalled()
  })

  it('type/press authorize the FOCUSED app at the full tier', async () => {
    const calls: Array<[string, DesktopAccessTier]> = []
    await expect(
      actOnDesktop({ action: 'type', text: 'hi' }, recordingAuthorize(calls), notepadProbes),
    ).rejects.toThrow('DENIED:Notepad:full')
    await expect(
      actOnDesktop({ action: 'press', keys: 'enter' }, recordingAuthorize(calls), notepadProbes),
    ).rejects.toThrow('DENIED:Notepad:full')
  })

  it('type fails CLOSED when no window reports focus', async () => {
    const probes: DesktopInputProbes = { ...notepadProbes, focusedWindowAppName: () => null }
    const authorize = vi.fn()
    await expect(actOnDesktop({ action: 'type', text: 'hi' }, authorize, probes)).rejects.toThrow(
      /Could not identify the focused app/,
    )
    expect(authorize).not.toHaveBeenCalled()
  })

  it('a drag authorizes BOTH ends (the drop can land on a different app)', async () => {
    const targets = new Map([
      ['5,5', 'Notepad'],
      ['700,50', 'PasswordSafe'],
    ])
    const probes: DesktopInputProbes = {
      resolveTargetFrame: () => ({ frame: { offsetX: 0, offsetY: 0, scale: 1 }, appName: null, bounds: null }),
      windowAppNameAt: (x, y) => targets.get(`${x},${y}`) ?? null,
      focusedWindowAppName: () => null,
    }
    const calls: Array<[string, DesktopAccessTier]> = []
    const allowNotepadOnly = (appName: string, required: DesktopAccessTier): void => {
      calls.push([appName, required])
      if (appName !== 'Notepad') throw new Error(`DENIED:${appName}:${required}`)
    }
    await expect(
      actOnDesktop({ action: 'drag', x: 5, y: 5, toX: 700, toY: 50 }, allowNotepadOnly, probes),
    ).rejects.toThrow('DENIED:PasswordSafe:click')
    expect(calls).toEqual([
      ['Notepad', 'click'],
      ['PasswordSafe', 'click'],
    ])
  })
})
