// Pixel capture of one app window — the fallback "eyes" for windows whose
// accessibility tree can't be read: a wake-refusing Electron app, canvas-drawn
// content, custom-drawn Qt (Telegram). Uses `node-screenshots` (napi binding of
// Rust XCap: BitBlt + PrintWindow/PW_RENDERFULLCONTENT on Windows), which
// captures a window WITHOUT focusing it — the one thing the a11y wake can never
// do. Element-addressing stays the primary path; this is observation only
// (Windows.Graphics.Capture is the future upgrade if BitBlt-class capture ever
// falls short — no maintained Node binding today).
//
// `node-screenshots` is a native module: loaded LAZILY via `createRequire` on
// first use (the `xa11y-loader.ts` pattern), so importing this adapter in tests
// or on a platform without the prebuilt binary never pulls the binary.
//
// EVERY field on node-screenshots' `Window` is a METHOD (`appName()`, `title()`,
// `isMinimized()`, `captureImageSync()`), not a property — so this module reads
// each window into a plain `WindowInfo` snapshot at the boundary, and the pure
// selection logic works on that snapshot (never on the live binding object).

import { createRequire } from 'node:module'
import { downscalePngToFit } from './screenshot-scale.js'
import { restoreIfMinimized } from './window-state.js'
import { planScreenshotTarget, selectWindowId, type WindowInfo } from './window-selection.js'
import type { DesktopAccessAuthorizer } from '../access/desktop-access-tiers.js'

// The pure selection layer lives in `window-selection.ts`; re-exported here so
// the a11y folder keeps ONE import point for the capture path's vocabulary.
export { selectWindowId, planScreenshotTarget } from './window-selection.js'
export type { WindowInfo, ScreenshotTarget } from './window-selection.js'

// The subset of node-screenshots' `Window` we call — methods, matching the
// binding's real 0.2.x shape (verified against its index.d.ts).
type NativeImage = {
  readonly width: number
  readonly height: number
  cropSync(x: number, y: number, width: number, height: number): NativeImage
  toPng(): Promise<Buffer>
}

type NativeWindow = {
  id(): number
  /** Owning process — the join key between this source and xa11y's app list. */
  pid(): number
  appName(): string
  title(): string
  isMinimized(): boolean
  isFocused(): boolean
  x(): number
  y(): number
  z(): number
  width(): number
  height(): number
  captureImageSync(): NativeImage
}
/** A display, as node-screenshots reports it. ⚠ MIXED UNITS: `x`/`y` are
 *  virtual-desktop coordinates shared with the input engine, but `width`/
 *  `height` are PHYSICAL pixels — on a scaled display the two differ by
 *  `scaleFactor`. Measured 2026-08-11; see `monitors.ts`. */
export type NativeMonitor = {
  id(): number
  name(): string
  x(): number
  y(): number
  width(): number
  height(): number
  rotation(): number
  scaleFactor(): number
  isPrimary(): boolean
}

type NodeScreenshotsModule = {
  Window: { all(): NativeWindow[] }
  Monitor: { all(): NativeMonitor[] }
}

let cachedModule: NodeScreenshotsModule | undefined

/** The ONE node-screenshots require point — shared with `window-identity.ts`
 *  (the enforcement lookups) so the binding stays single-loaded. */
export function loadNodeScreenshots(): NodeScreenshotsModule {
  if (cachedModule !== undefined) {
    return cachedModule
  }
  try {
    const requireFromHere = createRequire(import.meta.url)
    cachedModule = requireFromHere('node-screenshots') as NodeScreenshotsModule
    return cachedModule
  } catch (cause) {
    throw new Error(
      'Desktop screenshots are unavailable: the node-screenshots capture engine failed to load ' +
        '(it needs the prebuilt native binary for this OS/arch). ' +
        (cause instanceof Error ? cause.message : String(cause)),
    )
  }
}

// Call each method defensively (the binding is native — a shape surprise must
// degrade to "no match", never a thrown TypeError deep in the ranking).
function readWindow(window: NativeWindow): WindowInfo {
  return {
    id: Number(window.id()),
    pid: Number(window.pid()),
    appName: String(window.appName()),
    title: String(window.title()),
    isMinimized: Boolean(window.isMinimized()),
    width: Number(window.width()),
    height: Number(window.height()),
  }
}


/** A window's on-screen rectangle (physical pixels) — the frame the coordinate
 *  input path translates window-relative clicks against. Carries the window's
 *  app name so the input path can enforce access against the RESOLVED app. */
export interface WindowBounds {
  appName: string
  x: number
  y: number
  width: number
  height: number
}

/**
 * Resolve a named app's window rectangle (the ranked, non-minimized match), so
 * a screenshot-relative (x,y) can be translated to absolute screen coords.
 * Null when no matching window is open. The one node-screenshots touchpoint
 * for geometry, shared with the coordinate input path.
 */
export function findAppWindowBounds(query: string): WindowBounds | null {
  const trimmedQuery = query.trim()
  if (trimmedQuery.length === 0) return null
  const { Window } = loadNodeScreenshots()
  const windows = Window.all()
    .filter((native) => !native.isMinimized())
    .map((native) => ({ native, info: readWindow(native) }))
  const winnerId = selectWindowId(
    windows.map((entry) => entry.info),
    trimmedQuery,
  )
  const winner = windows.find((entry) => entry.info.id === winnerId)
  if (winner === undefined) return null
  return {
    appName: winner.info.appName,
    x: Number(winner.native.x()),
    y: Number(winner.native.y()),
    width: Number(winner.native.width()),
    height: Number(winner.native.height()),
  }
}

export type AppScreenshot = {
  pngBase64: string
  appName: string
  windowTitle: string
  /** Pixel size of the RETURNED image (post-zoom, post-downscale) — the
   *  coordinate frame the model sees. */
  width: number
  height: number
  /** The window's full size in physical pixels — the act coordinate frame. */
  windowWidth: number
  windowHeight: number
  /** Downscale factor applied to a full-window capture (1 = none). The input
   *  path recomputes the same factor from the window bounds when translating. */
  scale: number
  /** The zoomed region (window-relative, physical pixels), when one was asked for. */
  region: ZoomRegion | null
}

/** A window-relative rectangle to zoom into (physical pixels, top-left origin). */
export type ZoomRegion = {
  x: number
  y: number
  width: number
  height: number
}

// Clamp a requested zoom region to the image, degrading to null (full capture)
// when nothing sensible remains. Pure + exported for tests.
export function clampZoomRegion(
  region: ZoomRegion,
  imageWidth: number,
  imageHeight: number,
): ZoomRegion | null {
  const x = Math.max(0, Math.floor(region.x))
  const y = Math.max(0, Math.floor(region.y))
  if (x >= imageWidth || y >= imageHeight) return null
  const width = Math.min(Math.floor(region.width), imageWidth - x)
  const height = Math.min(Math.floor(region.height), imageHeight - y)
  if (width <= 0 || height <= 0) return null
  return { x, y, width, height }
}

/**
 * Capture a named app's window as a PNG (base64). Matches app name OR window
 * title (case-insensitive substring, ranked). Throws actionable errors: app not
 * open, window minimized (BitBlt-class capture has no pixels to read), capture
 * engine unavailable.
 */
export async function screenshotApp(
  query: string,
  authorize?: DesktopAccessAuthorizer,
  options: { region?: ZoomRegion } = {},
  // Internal: the auto-restore retry. A minimized window has no pixels, so the
  // first pass restores it (at the read tier — Kafi 2026-08-11) and re-enters
  // ONCE with `restore` disabled, so a window that refuses to restore ends in
  // the honest error instead of looping.
  internal: { restore?: (pid: number) => Promise<boolean>; alreadyRestored?: boolean } = {},
): Promise<AppScreenshot> {
  const restore = internal.restore ?? restoreIfMinimized
  const trimmedQuery = query.trim()
  if (trimmedQuery.length === 0) {
    throw new Error(
      'screenshotApp: an app name (or part of it) is required — name the app to capture.',
    )
  }
  const { Window } = loadNodeScreenshots()
  // Read every window into plain data once, keeping the native handle beside it
  // so the winner can be captured.
  const windows = Window.all().map((native) => ({ native, info: readWindow(native) }))

  const target = planScreenshotTarget(
    windows.map((entry) => entry.info),
    trimmedQuery,
    internal.alreadyRestored === true,
  )
  if (target.kind === 'not-open') {
    throw new Error(
      `Could not screenshot "${trimmedQuery}": no matching window is open. Call list_open_apps to see available apps.`,
    )
  }
  // ENFORCE FIRST, for every remaining branch — even "that window exists and is
  // minimized" is information about an ungranted app, and restoring one is an
  // action on it. Nothing below this line touches a window whose grant failed.
  authorize?.(target.appName, 'read')
  if (target.kind === 'unrestorable') {
    throw new Error(
      `The "${target.appName}" window is minimized and couldn't be restored automatically — ` +
        'ask the user to open it, then retry.',
    )
  }
  if (target.kind === 'restore') {
    // Auto-restore at the read tier, then re-capture — the user may be away, so
    // "ask them to restore it" is a dead end for the remote case (Kafi
    // 2026-08-11). The retry re-enters with `alreadyRestored`, so a window that
    // refuses to come back lands on `unrestorable` instead of looping.
    await restore(target.pid)
    return screenshotApp(query, authorize, options, { restore, alreadyRestored: true })
  }
  const winner = windows.find((entry) => entry.info.id === target.windowId)
  if (winner === undefined) {
    throw new Error(
      `Could not screenshot "${trimmedQuery}": the window disappeared before it could be captured. Retry.`,
    )
  }

  const captured = winner.native.captureImageSync()
  const zoom = options.region !== undefined
    ? clampZoomRegion(options.region, captured.width, captured.height)
    : null
  // A zoomed region ships at FULL resolution (detail is the point of zooming);
  // only the full-window capture is downscaled toward WXGA for coordinate
  // accuracy (`screenshot-scale.ts`).
  const image = zoom !== null ? captured.cropSync(zoom.x, zoom.y, zoom.width, zoom.height) : captured
  const png = await image.toPng()
  const fitted =
    zoom !== null
      ? { png, width: image.width, height: image.height, scale: 1 }
      : await downscalePngToFit(png, image.width, image.height)
  return {
    pngBase64: fitted.png.toString('base64'),
    appName: winner.info.appName,
    windowTitle: winner.info.title,
    width: fitted.width,
    height: fitted.height,
    windowWidth: winner.info.width,
    windowHeight: winner.info.height,
    scale: fitted.scale,
    region: zoom,
  }
}
