import { describe, it, expect, vi } from 'vitest'
import type { AppScreenshot } from '../a11y/screenshot-adapter.js'
import type { DesktopScreenshot } from '../a11y/screenshot-desktop.js'
import {
  captureActObservation,
  parseObserveRequest,
  OBSERVE_SETTLE_DEFAULT_MS,
  OBSERVE_SETTLE_MAX_MS,
} from './act-observation.js'

const appShot: AppScreenshot = {
  pngBase64: 'QUJD',
  appName: 'Google Chrome',
  windowTitle: 'Example — Google Chrome',
  width: 1280,
  height: 720,
  windowWidth: 1280,
  windowHeight: 720,
  scale: 1,
  region: null,
  restored: false,
}

const screenShot: DesktopScreenshot = {
  pngBase64: 'REVG',
  monitor: {
    id: 1,
    name: 'primary',
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    scaleFactor: 1,
    rotationDegrees: 0,
    isPrimary: true,
  },
  width: 1280,
  height: 720,
  scale: 0.667,
}

describe('parseObserveRequest', () => {
  it('defaults to no observation and the standard settle', () => {
    expect(parseObserveRequest({})).toEqual({ observe: false, settleMs: OBSERVE_SETTLE_DEFAULT_MS })
  })

  it('clamps the settle into [0, max] — a settle must never become an unbounded sleep', () => {
    expect(parseObserveRequest({ observe: true, observeSettleMs: 60000 }).settleMs).toBe(
      OBSERVE_SETTLE_MAX_MS,
    )
    expect(parseObserveRequest({ observe: true, observeSettleMs: -5 }).settleMs).toBe(0)
  })
})

describe('captureActObservation', () => {
  it('captures the named app after the settle, with the act-frame caption', async () => {
    const order: string[] = []
    const sleep = vi.fn(async () => {
      order.push('sleep')
    })
    const captureApp = vi.fn(async () => {
      order.push('capture')
      return appShot
    })
    const content = await captureActObservation('Chrome', 3000, { captureApp, sleep })
    expect(sleep).toHaveBeenCalledWith(3000)
    // Settle BEFORE capture — a screenshot taken mid-repaint reads as "empty app".
    expect(order).toEqual(['sleep', 'capture'])
    expect(content[0]).toEqual(
      expect.objectContaining({ type: 'text', text: expect.stringContaining('act frame') }),
    )
    expect(content[1]).toEqual({ type: 'image', data: 'QUJD', mimeType: 'image/png' })
  })

  it('falls back to the primary screen when the call had no app — teaching the aiming math', async () => {
    const captureScreen = vi.fn(async () => screenShot)
    const content = await captureActObservation(undefined, 0, { captureScreen })
    expect(captureScreen).toHaveBeenCalled()
    // Raw image coords fed into an app-less click would miss by 1/scale — the
    // caption must carry the same formula screenshot_desktop teaches.
    expect(content[0]).toEqual(
      expect.objectContaining({ type: 'text', text: expect.stringContaining('x/0.667') }),
    )
    expect(content[1]).toEqual({ type: 'image', data: 'REVG', mimeType: 'image/png' })
  })

  it('NEVER throws — a failed capture becomes a note, because the act already happened', async () => {
    const captureApp = vi.fn(async () => {
      throw new Error('no matching window is open')
    })
    const content = await captureActObservation('Gone App', 0, { captureApp })
    expect(content).toHaveLength(1)
    expect(content[0]).toEqual(
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('The act ran, but the follow-up observation failed'),
      }),
    )
  })
})
