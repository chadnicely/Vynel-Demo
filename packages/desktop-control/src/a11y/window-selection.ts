// Choosing WHICH window a request means — the pure half of the capture path.
// Plain data in, a decision out: no native binding, no I/O, so every branch
// (including the minimized/restore/give-up one) is testable without the
// prebuilt capture binary.
//
// Split from `screenshot-adapter.ts` so the adapter is left with the side of
// the job that genuinely needs the binding — loading it, reading geometry, and
// capturing pixels.

import { selectWindowedPid, type WindowedProcess } from './windowed-process.js'

// A window read into plain data at the binding boundary — the pure selection
// works on this, never on the live native window (whose fields are methods).
export interface WindowInfo {
  id: number
  /** The OWNING OS process (node-screenshots' `pid()`) — the handle the
   *  window-state ops restore through. Distinct from `id`, which is the
   *  capture binding's own window identifier. */
  pid: number
  appName: string
  title: string
  isMinimized: boolean
  width: number
  height: number
}

/**
 * Pick the id of the window matching the query — the SAME ranked selection as
 * the a11y pid fallback (`selectWindowedPid`), the window id standing in for the
 * pid, so "screenshot Discord" and "read Discord" resolve the same window.
 */
export function selectWindowId(windows: WindowInfo[], query: string): number | null {
  const asProcesses: WindowedProcess[] = windows.map((window) => ({
    pid: window.id,
    processName: window.appName,
    windowTitle: window.title,
  }))
  return selectWindowedPid(asProcesses, query)
}

/**
 * What a capture request resolves to, decided from the window snapshot alone.
 *
 * Every outcome carries the app name it concerns, which is what lets the caller
 * AUTHORIZE between deciding and acting: the enforcement point sits structurally
 * between the two, so no branch can reach a window before its grant is checked.
 */
export type ScreenshotTarget =
  | { kind: 'capture'; windowId: number; appName: string }
  | { kind: 'restore'; pid: number; appName: string }
  | { kind: 'unrestorable'; appName: string }
  | { kind: 'not-open' }

export function planScreenshotTarget(
  windows: WindowInfo[],
  query: string,
  alreadyRestored: boolean,
): ScreenshotTarget {
  const visible = windows.filter((window) => !window.isMinimized)
  const winnerId = selectWindowId(visible, query)
  const winner = visible.find((window) => window.id === winnerId)
  if (winner !== undefined) {
    return { kind: 'capture', windowId: winner.id, appName: winner.appName }
  }
  // Distinguish "minimized" from "not open" — different user action, and only
  // the former is recoverable.
  const minimized = windows.filter((window) => window.isMinimized)
  const minimizedId = selectWindowId(minimized, query)
  const minimizedWinner = minimized.find((window) => window.id === minimizedId)
  if (minimizedWinner === undefined) return { kind: 'not-open' }
  // One restore attempt only — a window that won't come back must end in the
  // honest error rather than looping.
  return alreadyRestored
    ? { kind: 'unrestorable', appName: minimizedWinner.appName }
    : { kind: 'restore', pid: minimizedWinner.pid, appName: minimizedWinner.appName }
}
