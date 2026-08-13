// Whole-DESKTOP capture — one monitor as a PNG, where screenshot_app captures
// one window. The fill item 10 held back until Kafi ruled on what it may SEE
// (2026-08-13: fully free, like every other look — the access model is
// "looking is ungated", and a screen the user asked about is a screen they are
// looking at themselves).
//
// One monitor per call, never a stitched virtual desktop: monitors differ in
// scale and rotation, a stitched image has holes wherever the layout is not
// rectangular, and the model reasons better about "screen 2's picture" than
// about a mosaic with negative-origin seams.

import type { MonitorInfo } from './monitors.js'
import { readMonitor } from './monitors.js'
import { loadNodeScreenshots } from './screenshot-adapter.js'
import { downscalePngToFit } from './screenshot-scale.js'

export type DesktopScreenshot = {
  pngBase64: string
  monitor: MonitorInfo
  /** Pixel size of the RETURNED image (post-downscale) — the frame the model sees. */
  width: number
  height: number
  /** Downscale factor applied to the full-monitor capture (1 = none). To turn a
   *  point seen in this image into a virtual-desktop coordinate:
   *  absolute = monitor origin + imagePoint / scale. */
  scale: number
}

/**
 * Capture one monitor. `monitorId` comes from `list_monitors`; omitted = the
 * primary. Throws actionable errors: unknown id, capture engine unavailable.
 */
export async function screenshotDesktop(monitorId?: number): Promise<DesktopScreenshot> {
  const { Monitor } = loadNodeScreenshots()
  const monitors = Monitor.all()
  const native =
    monitorId === undefined
      ? (monitors.find((candidate) => Boolean(candidate.isPrimary())) ?? monitors[0])
      : monitors.find((candidate) => Number(candidate.id()) === monitorId)
  if (native === undefined) {
    const known = monitors.map((candidate) => Number(candidate.id())).join(', ')
    throw new Error(
      monitorId === undefined
        ? 'Could not capture the desktop: no monitor was found.'
        : `No monitor has id ${monitorId}. Call list_monitors — known ids: ${known}.`,
    )
  }
  const info = readMonitor(native)
  const image = native.captureImageSync()
  const png = await image.toPng()
  const fitted = await downscalePngToFit(png, image.width, image.height)
  return {
    pngBase64: fitted.png.toString('base64'),
    monitor: info,
    width: fitted.width,
    height: fitted.height,
    scale: fitted.scale,
  }
}
