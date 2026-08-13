// What state ONE app is in, without touching it.
//
// WHY this exists. `list_open_apps` answers "what is open" but says nothing
// about the app you actually care about, and the only way to find out whether
// a window was minimized used to be to CAPTURE it — which restores it. So the
// question "is Discord minimized?" could only be answered by un-minimizing
// Discord. Looking changed the thing being looked at, and nothing said so.
//
// This is the passive half: it reads the window list and the process list and
// reports. It never restores, never focuses, never sends a keystroke.

import { findWindowedPidByName, isProcessRunningByName } from './windowed-process.js'
import { loadNodeScreenshots } from './screenshot-adapter.js'
import { readWindowIdentity } from './window-host-processes.js'
import { isAppNameMatch } from './app-name-match.js'

export type AppState =
  /** Not running at all — `launch_app` is the way in. */
  | { kind: 'not-running'; query: string }
  /** Running, but no window: minimized to the system tray (hidden, not
   *  minimized — the two need opposite recoveries). */
  | { kind: 'tray'; query: string }
  /** Has a window, currently minimized — readable only after a restore. */
  | { kind: 'minimized'; appName: string; windowTitle: string }
  /** Has a visible window. `foreground` says whether it is the one the user is
   *  actually looking at — a window can be open and completely covered. */
  | {
      kind: 'open'
      appName: string
      windowTitle: string
      foreground: boolean
      x: number
      y: number
      width: number
      height: number
    }

/** One window as the state reader needs it — plain data, so the choosing logic
 *  below is pure and testable without the capture binary. */
export type AppWindowCandidate = {
  appName: string
  windowTitle: string
  isMinimized: boolean
  isFocused: boolean
  x: number
  y: number
  width: number
  height: number
}

/**
 * Pick the window that best answers "what state is this app in".
 *
 * A VISIBLE window beats a minimized one: an app with both (a main window and a
 * minimized helper) is, to the user, open. Reporting "minimized" there would
 * send the model to restore something that is already on screen.
 */
export function chooseAppWindow(
  candidates: AppWindowCandidate[],
  query: string,
): AppWindowCandidate | null {
  const matching = candidates.filter(
    (candidate) =>
      isAppNameMatch(candidate.appName, query) || isAppNameMatch(candidate.windowTitle, query),
  )
  if (matching.length === 0) return null
  const visible = matching.filter((candidate) => !candidate.isMinimized)
  const pool = visible.length > 0 ? visible : matching
  // Among visible windows prefer the focused one, then the largest — the main
  // window, rather than a tooltip or a splash that happens to share the name.
  return (
    [...pool].sort(
      (a, b) =>
        Number(b.isFocused) - Number(a.isFocused) || b.width * b.height - a.width * a.height,
    )[0] ?? null
  )
}

/** Turn the chosen window (or its absence) into the reported state. Pure. */
export function decideAppState(
  window: AppWindowCandidate | null,
  query: string,
  running: boolean,
): AppState {
  if (window === null) {
    // No window and RUNNING is the tray case — the distinction that stops us
    // telling the user a running app is closed.
    return running ? { kind: 'tray', query } : { kind: 'not-running', query }
  }
  if (window.isMinimized) {
    return { kind: 'minimized', appName: window.appName, windowTitle: window.windowTitle }
  }
  return {
    kind: 'open',
    appName: window.appName,
    windowTitle: window.windowTitle,
    foreground: window.isFocused,
    x: window.x,
    y: window.y,
    width: window.width,
    height: window.height,
  }
}

/** The live window roster, as plain candidates. */
function readWindowCandidates(): AppWindowCandidate[] {
  const { Window } = loadNodeScreenshots()
  const candidates: AppWindowCandidate[] = []
  for (const native of Window.all()) {
    try {
      const identity = readWindowIdentity(native)
      if (identity === null) continue
      candidates.push({
        appName: identity,
        windowTitle: String(native.title() ?? ''),
        isMinimized: Boolean(native.isMinimized()),
        isFocused: Boolean(native.isFocused()),
        x: Number(native.x()),
        y: Number(native.y()),
        width: Number(native.width()),
        height: Number(native.height()),
      })
    } catch {
      // A shape surprise on one window must not blind the whole lookup.
    }
  }
  return candidates
}

export type AppStateProbes = {
  windows?: () => AppWindowCandidate[]
  findPid?: (query: string) => Promise<number | null>
  isRunning?: (query: string) => Promise<boolean>
}

/** Read one app's state. Touches nothing. */
export async function readAppState(query: string, probes: AppStateProbes = {}): Promise<AppState> {
  const trimmed = query.trim()
  if (trimmed.length === 0) throw new Error('readAppState: an app name is required.')
  const listWindows = probes.windows ?? readWindowCandidates
  const findPid = probes.findPid ?? findWindowedPidByName
  const isRunning = probes.isRunning ?? isProcessRunningByName

  const window = chooseAppWindow(listWindows(), trimmed)
  if (window !== null) return decideAppState(window, trimmed, true)
  // Only NOW pay for the process probes — a resolved window already answered
  // the question, and each of these is a PowerShell spawn.
  const running = (await findPid(trimmed)) !== null || (await isRunning(trimmed))
  return decideAppState(null, trimmed, running)
}

/** The state as a sentence, with the recovery that fits it — each kind needs a
 *  different next step, and naming the wrong one sends the model in circles. */
export function describeAppState(state: AppState): string {
  switch (state.kind) {
    case 'not-running':
      return (
        `"${state.query}" is not running. Use list_installed_apps to find it, then launch_app to ` +
        'start it.'
      )
    case 'tray':
      return (
        `"${state.query}" IS running but has no window — it is minimized to the system tray ` +
        '(hidden, not minimized). Call launch_app with its installed name to bring it back; ' +
        'activating an app that is already running is what clicking its Start-menu entry does.'
      )
    case 'minimized':
      return (
        `"${state.appName}" is open but MINIMIZED (window: "${state.windowTitle}"). Nothing is ` +
        'visible on screen. screenshot_app will restore it for you — say so to the user, since ' +
        'that changes what is on their screen. snapshot_app can often read it as it is.'
      )
    case 'open':
      return (
        `"${state.appName}" is open and visible (window: "${state.windowTitle}"), ` +
        `${state.width}x${state.height} at ${state.x},${state.y}` +
        (state.foreground
          ? ' — and it is the window the user is looking at.'
          : ' — but it is NOT in front; another window is on top of it.')
      )
  }
}
