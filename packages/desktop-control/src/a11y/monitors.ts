// Display topology — which screens exist, where they sit, how they're scaled.
//
// WHY this exists: every other primitive in this package addresses a WINDOW, so
// the model had no way to know a second monitor existed at all. It could not
// answer "what's on my other screen?", and an absolute-coordinate action on a
// display left of the primary was a guess (those coordinates are NEGATIVE).
//
// ⚠ THERE IS NO UNITS TRAP — and an earlier version of this file invented one.
//
// It claimed the origin was virtual-desktop while the size was physical, and
// derived a "logical" rectangle to aim with. That was WRONG, and measuring it
// properly killed it: a per-monitor-DPI-aware process (the frame both nut.js's
// `setPosition` and Win32 `SetWindowPos` run in) reports this machine's 125%
// panel as `-1080,-847 1080x1920` — byte-identical to what node-screenshots
// reports. Origin AND size are the same frame, consistently.
//
// The invented "logical" size was 864x1536, so a window told to fill that screen
// would have covered 64% of it. That is the same phantom-correction mistake as
// the retracted DPI bug (see `docs/module-notes/desktop-autopilot.md`), one
// layer up: a plausible theory, a self-consistent measurement that could not
// disprove it, and a correction applied to something that was already right.
//
// So: report what the OS reports, and let `scaleFactor` be information about the
// display rather than a factor anyone multiplies by. Window geometry was never
// affected either — a window's bounds and its capture agree, and `translatePoint`
// is coherent as-is (verified against Win32 GetCursorPos).

import { loadNodeScreenshots, type NativeMonitor } from './screenshot-adapter.js'

export interface MonitorInfo {
  id: number
  name: string
  /** Virtual-desktop origin. May be negative. Same frame as `width`/`height`. */
  x: number
  y: number
  /** Size in that SAME frame — the one clicks and window moves both use. */
  width: number
  height: number
  /** 1 = 100%, 1.25 = 125%. INFORMATION about the display: it tells the model
   *  the user's UI is enlarged, so text and controls are bigger than the pixel
   *  count suggests. It is NOT a factor to multiply coordinates by. */
  scaleFactor: number
  rotationDegrees: number
  isPrimary: boolean
}

/** Read one native monitor into a plain snapshot. Every field is a METHOD on the
 *  binding (the `readWindow` precedent). The coercions guard the VALUE, not the
 *  call — a binding missing a method still throws, which `listMonitors` handles
 *  by failing the whole listing rather than reporting a phantom screen. */
export function readMonitor(monitor: NativeMonitor): MonitorInfo {
  const scaleFactor = Number(monitor.scaleFactor())
  const safeScale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1
  return {
    id: Number(monitor.id()),
    name: String(monitor.name()),
    // Reported verbatim. Nothing is divided, scaled, or "corrected" — see the
    // header: the last time this file did that, it shrank a full-screen window
    // to 64% of the display.
    x: Number(monitor.x()),
    y: Number(monitor.y()),
    width: Number(monitor.width()),
    height: Number(monitor.height()),
    scaleFactor: safeScale,
    rotationDegrees: Number(monitor.rotation()),
    isPrimary: Boolean(monitor.isPrimary()),
  }
}

/** Every connected display, primary first (the model's default frame of
 *  reference), then by position so the order matches the physical layout. */
export function listMonitors(): MonitorInfo[] {
  const { Monitor } = loadNodeScreenshots()
  return Monitor.all()
    .map(readMonitor)
    .sort((left, right) => {
      if (left.isPrimary !== right.isPrimary) return left.isPrimary ? -1 : 1
      return left.x - right.x || left.y - right.y
    })
}
