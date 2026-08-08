// Window-identity primitives for ACCESS ENFORCEMENT — "which app actually
// receives this input?" answered from the live window list (node-screenshots,
// via the shared lazy loader in `screenshot-adapter.ts`): the focused window
// for keystrokes, the topmost window under a point for mouse actions, and the
// name roster the grant door resolves against. Split from the screenshot
// adapter because these serve the access model, not capture.

import { loadNodeScreenshots } from './screenshot-adapter.js'

/**
 * The app name of the window that currently has keyboard focus — the
 * enforcement target for focus-directed input (type / key-press), which lands
 * wherever the OS focus is regardless of any coordinates. Null when nothing
 * reports focus (fail closed at the caller).
 */
export function findFocusedWindowAppName(): string | null {
  const { Window } = loadNodeScreenshots()
  const focused = Window.all().find((native) => {
    try {
      return native.isFocused() && !native.isMinimized()
    } catch {
      return false
    }
  })
  return focused !== undefined ? String(focused.appName()) : null
}

/** A window's rectangle + stacking order, read into plain data for the pure
 *  hit-test below. */
export interface WindowHitCandidate {
  appName: string
  isMinimized: boolean
  x: number
  y: number
  width: number
  height: number
  z: number
}

/**
 * The topmost candidate containing the point — HIGHER z wins (verified
 * empirically against node-screenshots 0.2.8 on Windows: the foreground-most
 * window carries the largest z). Sorted explicitly rather than trusting
 * `Window.all()`'s enumeration order — this is an enforcement primitive.
 * Pure + exported for tests.
 */
export function pickTopmostWindowAt(
  candidates: WindowHitCandidate[],
  x: number,
  y: number,
): WindowHitCandidate | null {
  const hits = candidates
    .filter(
      (candidate) =>
        !candidate.isMinimized &&
        x >= candidate.x &&
        x < candidate.x + candidate.width &&
        y >= candidate.y &&
        y < candidate.y + candidate.height,
    )
    .sort((a, b) => b.z - a.z)
  return hits[0] ?? null
}

/**
 * The app name of the topmost window under an ABSOLUTE screen point — the
 * enforcement target for absolute-coordinate mouse actions. Null when no
 * window contains the point (fail closed at the caller — clicking into the
 * void is not an authorized target).
 */
export function findWindowAppNameAtPoint(x: number, y: number): string | null {
  const { Window } = loadNodeScreenshots()
  const candidates: WindowHitCandidate[] = Window.all().map((native) => ({
    appName: String(native.appName()),
    isMinimized: Boolean(native.isMinimized()),
    x: Number(native.x()),
    y: Number(native.y()),
    width: Number(native.width()),
    height: Number(native.height()),
    z: Number(native.z()),
  }))
  return pickTopmostWindowAt(candidates, x, y)?.appName ?? null
}

/**
 * Distinct app names across the current windows (minimized included — a
 * minimized app is still identifiable and grantable). One of the two identity
 * sources `request_desktop_access` resolves against: xa11y's `App.list()`
 * misses the Electron/Chromium class (tree off until woken), and a grant that
 * can't NAME those apps would deadlock the exact screenshot/wake paths built
 * for them.
 */
export function listWindowAppNames(): string[] {
  const { Window } = loadNodeScreenshots()
  const names = new Set<string>()
  for (const native of Window.all()) {
    const appName = String(native.appName())
    if (appName.length > 0) names.add(appName)
  }
  return [...names]
}
