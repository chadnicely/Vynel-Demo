// The coordinate-input ENFORCEMENT seam — target resolution + the two walls
// every mouse/keyboard action passes before the input engine is allowed to
// load. Split from `desktop-input.ts` (the execution side) so the access
// logic has one focused home.

import { findAppWindowBounds } from '../a11y/screenshot-adapter.js'
import { findFocusedWindowAppName, findWindowAppNameAtPoint } from '../a11y/window-identity.js'
import { computeCaptureScale } from '../a11y/screenshot-scale.js'
import type { DesktopAccessAuthorizer, DesktopAccessTier } from '../access/desktop-access-tiers.js'
import type { CoordinateFrame } from './desktop-input.js'

/** The window rectangle behind a named frame — carried so window-relative
 *  coordinates can be CONFINED to it. */
export interface FrameBounds {
  x: number
  y: number
  width: number
  height: number
}

export type ResolvedTargetFrame = {
  frame: CoordinateFrame
  /** Null for the absolute (no-app) frame. */
  appName: string | null
  bounds: FrameBounds | null
}

// Resolve the coordinate frame — the one place that reaches node-screenshots for
// the window origin. Fails closed with an actionable error when the named app
// isn't open (so a click never lands at a stale/absolute position by surprise).
//
// DPI PRECONDITION: the window origin here is in node-screenshots' PHYSICAL
// pixels, and nut.js `setPosition` expects the OS coordinate space. These
// coincide only at 100% display scaling; on a scaled display (125%/150%) the
// captured image, the reported window size, and the cursor can diverge and a
// window-relative click lands off-target. Verified coherent at 100%; a scale
// factor is the fix if a scaled display shows drift (see `translatePoint`).
function resolveFrame(app: string | undefined): ResolvedTargetFrame {
  if (app === undefined || app.trim().length === 0) {
    return { frame: { offsetX: 0, offsetY: 0 }, appName: null, bounds: null }
  }
  const bounds = findAppWindowBounds(app)
  if (bounds === null) {
    // A MINIMIZED window has no on-screen rectangle, so it lands here too —
    // and the generic advice ("omit app for absolute coordinates") would be
    // actively wrong there: it would aim a click at a window that isn't on the
    // screen. Name the real recovery instead. Unlike the a11y/screenshot paths,
    // the coordinate path does NOT auto-restore: it needs a settled on-screen
    // rectangle captured AFTER the restore, so the model must re-observe anyway.
    throw new Error(
      `Could not resolve the "${app}" window to translate coordinates — it may be minimized or ` +
        'closed. Call list_open_apps to check; if it is minimized, screenshot_app restores it for ' +
        'you (or use set_window_state), then re-capture and retry with fresh coordinates.',
    )
  }
  return {
    frame: {
      offsetX: bounds.x,
      offsetY: bounds.y,
      // The same deterministic factor screenshot_app downscaled by — model
      // coordinates arrive in the scaled image's frame.
      scale: computeCaptureScale(bounds.width, bounds.height),
    },
    appName: bounds.appName,
    bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
  }
}

/** The OS lookups enforcement depends on — injectable so every fail-closed
 *  branch is testable without the native binaries. */
export type DesktopInputProbes = {
  resolveTargetFrame: (app: string | undefined) => ResolvedTargetFrame
  windowAppNameAt: (x: number, y: number) => string | null
  focusedWindowAppName: () => string | null
}

export const DEFAULT_INPUT_PROBES: DesktopInputProbes = {
  resolveTargetFrame: resolveFrame,
  windowAppNameAt: findWindowAppNameAtPoint,
  focusedWindowAppName: findFocusedWindowAppName,
}

// Enforcement for a coordinate action, two independent walls:
//   1. CONFINEMENT — window-relative coordinates must land INSIDE the named
//      window's rectangle. Without this, a grant for one app buys clicks
//      anywhere on screen (app: "Notepad", x: 5000 translates right past it).
//   2. IDENTITY — the app actually receiving the input is the topmost window
//      under the translated point (an overlapping always-on-top window, not
//      the named frame, would get the click), and THAT app's grant is checked.
//      The named frame's identity is only the fallback when the hit-test
//      cannot see the point at all.
// An unidentifiable target fails CLOSED.
export function authorizeMouseTarget(
  authorize: DesktopAccessAuthorizer | undefined,
  probes: DesktopInputProbes,
  resolved: ResolvedTargetFrame,
  point: { x: number; y: number },
  required: DesktopAccessTier,
): void {
  if (authorize === undefined) return
  if (resolved.bounds !== null) {
    const inside =
      point.x >= resolved.bounds.x &&
      point.x < resolved.bounds.x + resolved.bounds.width &&
      point.y >= resolved.bounds.y &&
      point.y < resolved.bounds.y + resolved.bounds.height
    if (!inside) {
      throw new Error(
        `Those coordinates land OUTSIDE the "${resolved.appName}" window, so the action was not ` +
          "performed. Window-relative coordinates must come from that window's screenshot — " +
          're-capture and retry.',
      )
    }
  }
  const target = probes.windowAppNameAt(point.x, point.y) ?? resolved.appName
  if (target === null) {
    throw new Error(
      `Could not identify the app at (${point.x}, ${point.y}), so the action was not performed. ` +
        'Name the window via "app" (window-relative coordinates) and retry.',
    )
  }
  authorize(target, required)
}

// Enforcement for focus-directed input (type / key-press): keystrokes land in
// whatever window HAS FOCUS, so that app is the target — coordinates play no
// part. Fails closed when no window reports focus.
export function authorizeFocusedTarget(
  authorize: DesktopAccessAuthorizer | undefined,
  probes: DesktopInputProbes,
  action: 'type' | 'press',
): void {
  if (authorize === undefined) return
  const target = probes.focusedWindowAppName()
  if (target === null) {
    throw new Error(
      `Could not identify the focused app, so the "${action}" action was not performed. ` +
        'Click into the target window first (or name it via "app" on a click), then retry.',
    )
  }
  authorize(target, 'full')
}
