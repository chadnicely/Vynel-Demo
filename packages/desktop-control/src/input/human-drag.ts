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
    distance === 0
      ? { x: from.x + nudge, y: from.y + nudge }
      : {
          x: Math.round(from.x + (dx / distance) * Math.min(nudge, distance)),
          y: Math.round(from.y + (dy / distance) * Math.min(nudge, distance)),
        }
  path.push(nudged)

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
