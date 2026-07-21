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

import { createRequire } from 'node:module'
import { selectWindowedPid, type WindowedProcess } from './windowed-process.js'

// Structural view of the node-screenshots surface we use — kept local so the
// dependency's own types never leak into the package surface.
type ScreenshotWindow = {
  id: number
  appName: string
  title: string
  isMinimized: boolean
  captureImage(): Promise<{ toPng(): Promise<Buffer> }>
}
type NodeScreenshotsModule = { Window: { all(): ScreenshotWindow[] } }

let cachedModule: NodeScreenshotsModule | undefined

function loadNodeScreenshots(): NodeScreenshotsModule {
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

/**
 * Pick the window matching the query — the SAME ranked selection as the a11y
 * pid fallback (`selectWindowedPid`), with the window id standing in for the
 * pid, so "screenshot Discord" and "read Discord" resolve the same window.
 * Pure (no I/O) for testing.
 */
export function selectScreenshotWindow(
  windows: ScreenshotWindow[],
  query: string,
): ScreenshotWindow | null {
  const asProcesses: WindowedProcess[] = windows.map((window) => ({
    pid: window.id,
    processName: window.appName,
    windowTitle: window.title,
  }))
  const selectedId = selectWindowedPid(asProcesses, query)
  return windows.find((window) => window.id === selectedId) ?? null
}

export type AppScreenshot = {
  pngBase64: string
  appName: string
  windowTitle: string
}

/**
 * Capture a named app's window as a PNG (base64). Matches app name OR window
 * title (case-insensitive substring, ranked). Throws actionable errors: app not
 * open, window minimized (BitBlt-class capture has no pixels to read), capture
 * engine unavailable.
 */
export async function screenshotApp(query: string): Promise<AppScreenshot> {
  const trimmedQuery = query.trim()
  if (trimmedQuery.length === 0) {
    throw new Error(
      'screenshotApp: an app name (or part of it) is required — name the app to capture.',
    )
  }
  const { Window } = loadNodeScreenshots()
  const windows = Window.all()
  const restored = windows.filter((window) => !window.isMinimized)
  const match = selectScreenshotWindow(restored, trimmedQuery)
  if (match === null) {
    // Distinguish "minimized" from "not open" — different user action.
    const minimizedMatch = selectScreenshotWindow(
      windows.filter((window) => window.isMinimized),
      trimmedQuery,
    )
    if (minimizedMatch !== null) {
      throw new Error(
        `The "${minimizedMatch.appName}" window is minimized — a minimized window has no pixels to ` +
          'capture. Ask the user to restore it, then retry.',
      )
    }
    throw new Error(
      `Could not screenshot "${trimmedQuery}": no matching window is open. Call list_open_apps to see available apps.`,
    )
  }
  const image = await match.captureImage()
  const png = await image.toPng()
  return {
    pngBase64: png.toString('base64'),
    appName: match.appName,
    windowTitle: match.title,
  }
}
