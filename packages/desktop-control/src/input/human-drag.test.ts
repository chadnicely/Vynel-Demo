import { describe, expect, it } from 'vitest'
import {
  buildDragPath,
  dragStepCountFor,
  DEFAULT_DRAG_STEPS,
  DEFAULT_THRESHOLD_NUDGE_PX,
  LONG_DRAG_STEPS,
  buildWaypointDragLegs,
} from './human-drag.js'

describe('dragStepCountFor', () => {
  it('uses the default density for an ordinary drag', () => {
    expect(dragStepCountFor({ x: 0, y: 0 }, { x: 200, y: 100 })).toBe(DEFAULT_DRAG_STEPS)
  })

  it('uses MORE points for a long cross-screen drag, not fewer', () => {
    // A sparse path over a long distance skips whole windows, so no drop target
    // ever sees a hover.
    expect(dragStepCountFor({ x: -1000, y: 0 }, { x: 1500, y: 400 })).toBe(LONG_DRAG_STEPS)
  })

  it('honours an explicit request', () => {
    expect(dragStepCountFor({ x: 0, y: 0 }, { x: 10, y: 10 }, 5)).toBe(5)
  })

  it('ignores a nonsense request rather than producing a pathless drag', () => {
    for (const bad of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(dragStepCountFor({ x: 0, y: 0 }, { x: 10, y: 10 }, bad)).toBe(DEFAULT_DRAG_STEPS)
    }
  })
})

describe('buildDragPath', () => {
  const from = { x: 100, y: 100 }
  const to = { x: 500, y: 300 }

  it('starts exactly on the grab point', () => {
    expect(buildDragPath(from, to)[0]).toEqual(from)
  })

  it('ENDS exactly on the target — a drop one pixel out is a drop into nothing', () => {
    expect(buildDragPath(from, to).at(-1)).toEqual(to)
  })

  it('nudges past the drag threshold before travelling, TOWARD the target', () => {
    const [, nudge] = buildDragPath(from, to)
    // Moved, but only a little, and in the direction of travel (a backwards
    // nudge on a short drag would leave the source).
    expect(nudge).toBeDefined()
    const travelled = Math.hypot(nudge!.x - from.x, nudge!.y - from.y)
    expect(travelled).toBeGreaterThan(0)
    expect(travelled).toBeLessThanOrEqual(DEFAULT_THRESHOLD_NUDGE_PX + 1)
    expect(nudge!.x).toBeGreaterThan(from.x)
    expect(nudge!.y).toBeGreaterThan(from.y)
  })

  it('emits the intermediate motion the OS drag protocol needs', () => {
    const path = buildDragPath(from, to, { steps: 10 })
    // grab + nudge + 10 interpolated
    expect(path).toHaveLength(12)
  })

  // At the SHIPPED density, not an override. An earlier version passed this
  // only because the test forced `steps: 10`; at the real default the path
  // walked back over the source between the nudge and the first interpolated
  // point. A backtracking path can drop onto whatever sits at the origin.
  it('never moves backwards, at the density it actually ships with', () => {
    for (const [start, end] of [
      [from, to],
      [{ x: 0, y: 0 }, { x: 20, y: 0 }],
      [{ x: 500, y: 500 }, { x: 100, y: 100 }],
      [{ x: -900, y: -400 }, { x: 800, y: 600 }],
    ] as const) {
      const path = buildDragPath(start, end)
      const forwardX = end.x >= start.x ? 1 : -1
      const forwardY = end.y >= start.y ? 1 : -1
      for (let i = 1; i < path.length; i += 1) {
        expect((path[i]!.x - path[i - 1]!.x) * forwardX).toBeGreaterThanOrEqual(0)
        expect((path[i]!.y - path[i - 1]!.y) * forwardY).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('still nudges for a zero-length drag — the threshold IS the point', () => {
    const path = buildDragPath({ x: 50, y: 50 }, { x: 50, y: 50 })
    expect(path[1]).not.toEqual({ x: 50, y: 50 })
    expect(path.at(-1)).toEqual({ x: 50, y: 50 })
  })

  it('never overshoots OR returns to the origin on a drag shorter than the nudge', () => {
    const path = buildDragPath({ x: 0, y: 0 }, { x: 4, y: 0 })
    for (const step of path) expect(step.x).toBeLessThanOrEqual(4)
    // The bug this guards: the nudge capped at the target, then interpolation
    // restarted from the origin — so the pointer arrived, went back to 0, and
    // crept forward again, able to drop on whatever sits at the source.
    expect(path.slice(1).every((step) => step.x > 0)).toBe(true)
    expect(path.at(-1)).toEqual({ x: 4, y: 0 })
  })

  it('a nonsense fractional step count still produces a real path, not a jump', () => {
    // Math.floor(0.5) would be 0 — a two-point path, i.e. exactly nut's naive
    // jump that this module exists to replace.
    const path = buildDragPath(from, to, { steps: 0.5 })
    expect(path.length).toBeGreaterThan(2)
    expect(path.at(-1)).toEqual(to)
  })

  it('handles negative coordinates (a monitor left of the primary)', () => {
    const path = buildDragPath({ x: -900, y: -400 }, { x: -300, y: -100 })
    expect(path[0]).toEqual({ x: -900, y: -400 })
    expect(path.at(-1)).toEqual({ x: -300, y: -100 })
  })
})

// Waypoints exist for the gestures that need a DECISION mid-hold: a
// spring-loaded folder that only expands once hovered, a tree that scrolls at
// its edge, a tab strip you must cross to reach another window. The alternative
// — raw press/release as separate tools — puts a tool-call boundary between
// them, and a turn that dies in that gap leaves the button DOWN across the whole
// desktop. Waypoints keep the release inside one call, where `finally` owns it.
describe('buildWaypointDragLegs', () => {
  const from = { x: 0, y: 0 }
  const via = { x: 100, y: 0 }
  const to = { x: 200, y: 0 }

  it('produces one leg per hop, so each can be dwelt on', () => {
    expect(buildWaypointDragLegs(from, [via], to)).toHaveLength(2)
    expect(buildWaypointDragLegs(from, [via, { x: 150, y: 50 }], to)).toHaveLength(3)
  })

  it('each leg starts where the previous one ended', () => {
    const legs = buildWaypointDragLegs(from, [via], to)
    expect(legs[0]?.[legs[0].length - 1]).toEqual(via)
    expect(legs[1]?.[0]).toEqual(via)
    expect(legs[1]?.[legs[1].length - 1]).toEqual(to)
  })

  it('nudges past the drag threshold ONCE, at the grab', () => {
    // A second nudge mid-drag would jerk the pointer sideways off the very
    // target it is standing on — the waypoint it was sent there to hover.
    const legs = buildWaypointDragLegs(from, [via], to)
    expect(legs[0]?.[0]).toEqual(from)
    expect(legs[0]?.[1]?.x).toBeGreaterThan(0)
    expect(legs[0]?.[1]?.x).toBeLessThan(via.x)
    // The second leg sets off straight from the waypoint.
    expect(legs[1]?.[1]?.x).toBeGreaterThan(via.x)
  })

  it('never moves backwards along a leg', () => {
    // The same monotonicity the single-segment path guarantees — a leg that
    // doubles back can drop onto whatever sits behind it.
    for (const leg of buildWaypointDragLegs(from, [via], to)) {
      for (let i = 1; i < leg.length; i += 1) {
        expect(leg[i]!.x).toBeGreaterThanOrEqual(leg[i - 1]!.x)
      }
    }
  })
})
