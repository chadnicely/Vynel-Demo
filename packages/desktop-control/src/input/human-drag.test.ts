import { describe, expect, it } from 'vitest'
import {
  buildDragPath,
  dragStepCountFor,
  DEFAULT_DRAG_STEPS,
  DEFAULT_THRESHOLD_NUDGE_PX,
  LONG_DRAG_STEPS,
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
    // Strictly progressing toward the target, so every window in between sees
    // the pointer cross it.
    const xs = path.map((step) => step.x)
    expect(xs).toEqual([...xs].sort((a, b) => a - b))
  })

  it('still nudges for a zero-length drag — the threshold IS the point', () => {
    const path = buildDragPath({ x: 50, y: 50 }, { x: 50, y: 50 })
    expect(path[1]).not.toEqual({ x: 50, y: 50 })
    expect(path.at(-1)).toEqual({ x: 50, y: 50 })
  })

  it('never overshoots on a drag shorter than the nudge', () => {
    const path = buildDragPath({ x: 0, y: 0 }, { x: 4, y: 0 })
    for (const step of path) expect(step.x).toBeLessThanOrEqual(4)
    expect(path.at(-1)).toEqual({ x: 4, y: 0 })
  })

  it('handles negative coordinates (a monitor left of the primary)', () => {
    const path = buildDragPath({ x: -900, y: -400 }, { x: -300, y: -100 })
    expect(path[0]).toEqual({ x: -900, y: -400 })
    expect(path.at(-1)).toEqual({ x: -300, y: -100 })
  })
})
