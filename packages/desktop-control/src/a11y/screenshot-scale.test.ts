import { describe, it, expect } from 'vitest'
import {
  computeCaptureScale,
  scaledCaptureSize,
  MAX_CAPTURE_WIDTH,
  MAX_CAPTURE_HEIGHT,
} from './screenshot-scale.js'

describe('computeCaptureScale', () => {
  it('leaves captures that already fit at scale 1', () => {
    expect(computeCaptureScale(1280, 800)).toBe(1)
    expect(computeCaptureScale(640, 480)).toBe(1)
  })

  it('fits an oversized capture inside 1280×800, aspect preserved', () => {
    // 1920×1200 → limited by width AND height equally here: 1280/1920 = 800/1200.
    expect(computeCaptureScale(1920, 1200)).toBeCloseTo(2 / 3)
    // Tall window: height is the binding constraint.
    expect(computeCaptureScale(1000, 1600)).toBe(MAX_CAPTURE_HEIGHT / 1600)
    // Wide window: width is the binding constraint.
    expect(computeCaptureScale(2560, 700)).toBe(MAX_CAPTURE_WIDTH / 2560)
  })

  it('degrades to 1 on nonsense dimensions (never divides by zero)', () => {
    expect(computeCaptureScale(0, 500)).toBe(1)
    expect(computeCaptureScale(500, -1)).toBe(1)
  })
})

describe('scaledCaptureSize', () => {
  it('rounds to whole pixels and never returns 0', () => {
    const size = scaledCaptureSize(1920, 1200)
    expect(size).toEqual({ width: 1280, height: 800, scale: 2 / 3 })
    expect(scaledCaptureSize(1, 1)).toEqual({ width: 1, height: 1, scale: 1 })
  })

  it('round-trips with the input path: image coord / scale ≈ window coord', () => {
    // A click at (640, 400) on the SCALED 1920×1200 capture must land at
    // (960, 600) in the window — the exact remap translatePoint applies.
    const { scale } = scaledCaptureSize(1920, 1200)
    expect(Math.round(640 / scale)).toBe(960)
    expect(Math.round(400 / scale)).toBe(600)
  })
})
