// Display topology — which screens exist, where they sit, how they're scaled.
//
// WHY this exists: every other primitive in this package addresses a WINDOW, so
// the model had no way to know a second monitor existed at all. It could not
// answer "what's on my other screen?", and an absolute-coordinate action on a
// display left of the primary was a guess (those coordinates are NEGATIVE).
//
// ⚠ THE UNITS TRAP, measured 2026-08-11 and the reason this file is not a
// two-line wrapper. node-screenshots reports a monitor's `x`/`y` in
// virtual-desktop coordinates — the SAME space nut.js positions the cursor in —
// but its `width`/`height` in PHYSICAL pixels. On a 125% display those differ by
// the scale factor, so `x + width` is NOT the monitor's right edge in the space
// a click uses. Deriving a click target from the raw rectangle lands off-screen.
//
// So this module reports BOTH: the physical size (what a capture of that screen
// would be) and the logical rectangle (what the input engine understands). The
// tool hands the model the logical one for aiming and labels the difference,
// because "1920x1080 at 125%" is information the model needs to interpret a
// screenshot, not a correction to apply itself.
//
// Window geometry is NOT affected — a window's bounds and its capture agree, and
// `translatePoint` is coherent as-is (verified against Win32 GetCursorPos).

import { loadNodeScreenshots, type NativeMonitor } from './screenshot-adapter.js'

export interface MonitorInfo {
  id: number
  name: string
  /** Virtual-desktop origin — the space the input engine uses. May be negative. */
  x: number
  y: number
  /** PHYSICAL pixel size — what a full capture of this screen measures. */
  physicalWidth: number
  physicalHeight: number
  /** Size in the coordinate space clicks use (physical ÷ scaleFactor). */
  logicalWidth: number
  logicalHeight: number
  /** 1 = 100%, 1.25 = 125%. */
  scaleFactor: number
  rotationDegrees: number
  isPrimary: boolean
}

/** Divide a physical extent by the scale factor, guarding a nonsense factor
 *  (a monitor unplugged mid-call can report 0). Pure. */
export function toLogicalExtent(physical: number, scaleFactor: number): number {
  if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) return Math.round(physical)
  return Math.round(physical / scaleFactor)
}

/** Read one native monitor into a plain snapshot. Every field is a METHOD on the
 *  binding (the `readWindow` precedent). The coercions guard the VALUE, not the
 *  call — a binding missing a method still throws, which `listMonitors` handles
 *  by failing the whole listing rather than reporting a phantom screen. */
export function readMonitor(monitor: NativeMonitor): MonitorInfo {
  const scaleFactor = Number(monitor.scaleFactor())
  const safeScale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1
  const physicalWidth = Number(monitor.width())
  const physicalHeight = Number(monitor.height())
  return {
    id: Number(monitor.id()),
    name: String(monitor.name()),
    x: Number(monitor.x()),
    y: Number(monitor.y()),
    physicalWidth,
    physicalHeight,
    logicalWidth: toLogicalExtent(physicalWidth, safeScale),
    logicalHeight: toLogicalExtent(physicalHeight, safeScale),
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
