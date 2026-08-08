// Screenshot fidelity per the official computer-use practices: models place
// coordinates most accurately on captures near XGA/WXGA size, so oversized
// windows are downscaled to fit 1280×800 (aspect preserved) and the input
// path divides window-relative coordinates by the SAME deterministic scale
// (`computeCaptureScale` from the window's current bounds — capture-time and
// click-time agree as long as the window wasn't resized in between).
//
// `sharp` (prebuilt native, already in the workspace lockfile) does the
// resampling. Loaded LAZILY via `createRequire` (the xa11y-loader pattern);
// if it cannot load, capture degrades to FULL RESOLUTION rather than failing
// — fidelity is an accuracy aid, never the reason a screenshot breaks.

import { createRequire } from 'node:module'

export const MAX_CAPTURE_WIDTH = 1280
export const MAX_CAPTURE_HEIGHT = 800

/** The downscale factor for a capture of the given size: 1 when it already
 *  fits, else the largest factor that fits both bounds. Pure. */
export function computeCaptureScale(width: number, height: number): number {
  if (width <= 0 || height <= 0) return 1
  return Math.min(1, MAX_CAPTURE_WIDTH / width, MAX_CAPTURE_HEIGHT / height)
}

/** The pixel size a capture lands at after `computeCaptureScale`. Pure. */
export function scaledCaptureSize(
  width: number,
  height: number,
): { width: number; height: number; scale: number } {
  const scale = computeCaptureScale(width, height)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  }
}

type SharpModule = (input: Buffer) => {
  resize(width: number, height: number): { png(): { toBuffer(): Promise<Buffer> } }
}

let cachedSharp: SharpModule | null | undefined

function loadSharp(): SharpModule | null {
  if (cachedSharp !== undefined) return cachedSharp
  try {
    const requireFromHere = createRequire(import.meta.url)
    cachedSharp = requireFromHere('sharp') as SharpModule
  } catch {
    // Degrade to full-resolution captures — see file header.
    cachedSharp = null
  }
  return cachedSharp
}

export type DownscaledPng = {
  png: Buffer
  width: number
  height: number
  /** 1 when no downscale happened (already fits, or sharp unavailable). */
  scale: number
}

export async function downscalePngToFit(
  png: Buffer,
  width: number,
  height: number,
): Promise<DownscaledPng> {
  const target = scaledCaptureSize(width, height)
  if (target.scale >= 1) return { png, width, height, scale: 1 }
  const sharp = loadSharp()
  if (sharp === null) return { png, width, height, scale: 1 }
  const resized = await sharp(png).resize(target.width, target.height).png().toBuffer()
  return { png: resized, width: target.width, height: target.height, scale: target.scale }
}
