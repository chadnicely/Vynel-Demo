// A drag the operating system actually believes.
//
// nut.js's `drag([from, to])` sends press → one jump → release. That is enough
// to move a slider, and it is why the naive version appeared to work. It is NOT
// enough for drag-and-drop: Windows OLE (like NSDragging and XDND) needs three
// things before a drop target will accept anything, and a single jump provides
// none of them —
//
//   1. THRESHOLD — a few pixels of movement while held, or the source never
//      enters drag mode and you have just done a long click.
//   2. INTERMEDIATE MOTION — one jump from A to B means no window in between,
//      including the target, ever sees a hover, so nothing arms itself to
//      accept the drop.
//   3. DWELL — targets need a moment with the pointer over them to register and
//      show their drop affordance; releasing the instant you arrive drops into
//      a target that was never listening.
//
// So the path is stepped and deliberately unhurried. This is slower than a jump
// by design; a drag that silently does nothing is worse than one that takes a
// second, because a failed drag usually looks exactly like "nothing happened"
// and the model concludes it succeeded.

import { loadNutInput } from './nut-input-loader.js'
import { withTimeout } from '../a11y/xa11y-loader.js'

/** A point on the interpolated path, in the same space the caller aims in. */
export interface DragStep {
  x: number
  y: number
}

export interface HumanDragOptions {
  /** Interpolated points between grab and drop (excluding the grab itself). */
  steps?: number
  /** Nudge past the OS drag threshold before travelling. */
  thresholdNudgePx?: number
}

export const DEFAULT_DRAG_STEPS = 40
export const DEFAULT_THRESHOLD_NUDGE_PX = 12
/** Crossing a screen boundary needs MORE intermediate events, not fewer — a
 *  long path with sparse points skips whole windows. */
export const LONG_DRAG_DISTANCE_PX = 1200
export const LONG_DRAG_STEPS = 70

/** How many interpolated points a path of this length deserves. Pure. */
export function dragStepCountFor(
  from: DragStep,
  to: DragStep,
  requested?: number,
): number {
  if (requested !== undefined && Number.isFinite(requested) && requested > 0) {
    // At least one — `Math.floor(0.5)` would be 0, and a zero-step path is the
    // naive two-point jump this whole module exists to replace.
    return Math.max(1, Math.floor(requested))
  }
  const distance = Math.hypot(to.x - from.x, to.y - from.y)
  return distance >= LONG_DRAG_DISTANCE_PX ? LONG_DRAG_STEPS : DEFAULT_DRAG_STEPS
}

/**
 * The full pointer path for a drag: the grab point, a short nudge past the
 * threshold, then interpolated travel ending exactly on the target.
 *
 * Pure and exported so the geometry is unit-testable without moving a mouse —
 * the parts that need a real desktop (press, dwell, release) stay in the caller.
 */
export function buildDragPath(
  from: DragStep,
  to: DragStep,
  options: HumanDragOptions = {},
): DragStep[] {
  const steps = dragStepCountFor(from, to, options.steps)
  const nudge = options.thresholdNudgePx ?? DEFAULT_THRESHOLD_NUDGE_PX
  const path: DragStep[] = [{ x: from.x, y: from.y }]

  // Nudge TOWARD the destination, so a short drag isn't first sent backwards.
  // A zero-length drag still nudges — the threshold is the point.
  const dx = to.x - from.x
  const dy = to.y - from.y
  const distance = Math.hypot(dx, dy)
  const nudged =
    nudge === 0
      ? { x: from.x, y: from.y }
      : distance === 0
      ? { x: from.x + nudge, y: from.y + nudge }
      : {
          x: Math.round(from.x + (dx / distance) * Math.min(nudge, distance)),
          y: Math.round(from.y + (dy / distance) * Math.min(nudge, distance)),
        }
  // A suppressed nudge (the later legs of a waypoint drag) would otherwise
  // push the grab point twice — harmless to the OS, but it makes the path lie
  // about where it starts moving, and every assertion about "the first step
  // after the grab" then reads the grab again.
  if (nudged.x !== from.x || nudged.y !== from.y) {
    path.push(nudged)
  }

  // Interpolate from the NUDGE, not from `from`. Restarting at `from` would
  // walk the pointer back over the source before setting off — visibly wrong,
  // and on a drag shorter than the nudge it overshoots the target and returns,
  // which can drop onto whatever sits at the origin.
  for (let step = 1; step <= steps; step += 1) {
    const progress = step / steps
    path.push({
      x: Math.round(nudged.x + (to.x - nudged.x) * progress),
      y: Math.round(nudged.y + (to.y - nudged.y) * progress),
    })
  }

  // Land exactly on target — rounding through the loop can leave it a pixel off,
  // and a drop one pixel outside the target is a drop into nothing.
  path[path.length - 1] = { x: to.x, y: to.y }
  return path
}

const DRAG_STEP_TIMEOUT_MS = 15000
/** A stepped drag is deliberately unhurried (dozens of interpolated moves, each
 *  with nut's own inter-step delay), so travel needs more headroom than a click. */
const DRAG_TRAVEL_TIMEOUT_MS = 30000
/** Held over the target before releasing, so it registers the hover. */
const DROP_DWELL_MS = 400

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Run the whole gesture: grab → press → threshold nudge → interpolated travel →
 * dwell → release.
 *
 * Lives here rather than in `desktop-input.ts` because the release discipline
 * below is part of the same idea as the path — both exist so a drag either
 * completes or leaves nothing behind.
 *
 * Coordinates arrive already translated AND authorized; this touches no part of
 * the access model.
 */
/**
 * The full path through any waypoints — one leg per hop, nudged only at the
 * grab (the threshold is crossed once, not at every corner).
 *
 * WHY waypoints exist. A single press→travel→release cannot do the gestures
 * that need a DECISION mid-hold: a spring-loaded folder that only expands once
 * you hover it, a tree that scrolls when you hold near its edge, a tab strip
 * you must cross to reach another window. The alternative — exposing raw
 * press/release as separate tools — puts a tool-call boundary between the two,
 * and a turn that dies in that gap leaves the button DOWN across the whole
 * desktop, turning every later click into a drag the user has to undo by hand.
 * Waypoints keep the release inside one call, where `finally` still owns it.
 */
export function buildWaypointDragLegs(
  from: DragStep,
  waypoints: DragStep[],
  to: DragStep,
  options: HumanDragOptions = {},
): DragStep[][] {
  const destinations = [...waypoints, to]
  let cursor = from
  return destinations.map((destination, index) => {
    // Only the FIRST leg nudges: later legs start from a pointer that is
    // already held and already moving, so a second nudge would jerk it
    // sideways off the target it is standing on.
    const leg = buildDragPath(
      cursor,
      destination,
      index === 0 ? options : { ...options, thresholdNudgePx: 0 },
    )
    cursor = destination
    return leg
  })
}

export async function performSteppedDrag(
  from: DragStep,
  to: DragStep,
  waypoints: DragStep[] = [],
): Promise<void> {
  const { mouse, Point, Button } = loadNutInput()
  // One entry per hop, so each can be walked and then dwelt on.
  const legs =
    waypoints.length > 0
      ? buildWaypointDragLegs(from, waypoints, to)
      : [buildDragPath(from, to)]
  await withTimeout(mouse.setPosition(new Point(from.x, from.y)), DRAG_STEP_TIMEOUT_MS, 'move')

  // The press is INSIDE the try, flagged before its await. `withTimeout` bounds
  // without cancelling (see `xa11y-loader.ts`), so a press that times out may
  // STILL have landed — pressing outside the try would leave the button down
  // with no release path, and every later click on the user's desktop would
  // become a drag they have to fix by hand.
  let buttonMayBeDown = false
  try {
    buttonMayBeDown = true
    await withTimeout(mouse.pressButton(Button.LEFT), DRAG_STEP_TIMEOUT_MS, 'drag')
    // A timeout here does NOT stop the native path walk — it keeps running
    // after we move on, which is why the release below is best-effort rather
    // than a guarantee that the gesture unwound cleanly.
    //
    // Walked LEG BY LEG when there are waypoints, with a dwell at each: a
    // waypoint the pointer merely passes through is no different from a
    // straight line, and the reason to stop there is precisely that the target
    // needs a moment to react — a spring-loaded folder to expand, a tab strip
    // to switch. One continuous `move` would arrive and leave in the same
    // frame, which is the naive jump this module exists to replace.
    for (const leg of legs) {
      await withTimeout(
        mouse.move(leg.map((step) => new Point(step.x, step.y))),
        DRAG_TRAVEL_TIMEOUT_MS,
        'drag',
      )
      await sleep(DROP_DWELL_MS)
    }
  } finally {
    if (buttonMayBeDown) {
      try {
        await withTimeout(mouse.releaseButton(Button.LEFT), DRAG_STEP_TIMEOUT_MS, 'drag')
      } catch {
        // Swallowed ON PURPOSE: a throw from `finally` REPLACES the error the
        // try was already raising, so a drag that failed for a real reason
        // would surface as a release timeout instead — hiding the actual cause
        // AND leaving the button down either way.
      }
    }
  }
}
