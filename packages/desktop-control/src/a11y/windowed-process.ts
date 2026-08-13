// PowerShell process listing for the Electron fallback — NOT xa11y (the
// `a11y/xa11y-loader.ts` boundary stays the single native touchpoint). Used
// when xa11y's UIA enumeration can't see an app: Electron apps (Discord,
// Slack, …) don't appear in `App.list()`, but their main window IS a real OS
// process we can reach by pid via `App.byPid`. Focus operations live in
// `window-focus.ts`.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const POWERSHELL_MAX_BUFFER = 4 * 1024 * 1024

export type WindowedProcess = { pid: number; processName: string; windowTitle: string }

/**
 * Pick the windowed process matching the query (case-insensitive substring, the
 * `isAppNameMatch` shape), RANKED — an Electron app spawns several windowed
 * helpers, and "first row wins" picked whichever `Get-Process` listed first:
 *   1. A process-NAME match beats a title-only match (a VS Code window titled
 *      "…chat…" must not outrank the `chat-app` process).
 *   2. Within a tier, the longest window title wins — the app's real main
 *      window carries the rich dynamic title ("@user - Discord"); stub/helper
 *      windows carry short or empty ones.
 *   3. Ties break to the lowest pid (deterministic).
 * Pure (no I/O) for testing.
 */
export function selectWindowedPid(processes: WindowedProcess[], query: string): number | null {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) {
    return null
  }
  const nameMatches = processes.filter((candidate) =>
    candidate.processName.toLowerCase().includes(needle),
  )
  const pool =
    nameMatches.length > 0
      ? nameMatches
      : processes.filter((candidate) => candidate.windowTitle.toLowerCase().includes(needle))
  if (pool.length === 0) {
    return null
  }
  const best = [...pool].sort(
    (a, b) => b.windowTitle.length - a.windowTitle.length || a.pid - b.pid,
  )[0]
  return best?.pid ?? null
}

type RawProcessRow = { Id?: unknown; ProcessName?: unknown; MainWindowTitle?: unknown }

/**
 * Resolve a visible app to its main-window process id by name/title. Windows-only
 * (PowerShell `Get-Process`, filtered to windows); returns null off-Windows, on a
 * PowerShell failure, or when nothing matches — the caller degrades to "not found".
 */
export async function findWindowedPidByName(query: string): Promise<number | null> {
  if (process.platform !== 'win32') {
    return null
  }
  try {
    const { stdout } = await execFileAsync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | " +
          'Select-Object Id, ProcessName, MainWindowTitle | ConvertTo-Json -Compress',
      ],
      // The timeout closes the same never-hang class as window-focus.ts — a
      // wedged spawn degrades to "not found" instead of stalling the turn.
      { windowsHide: true, maxBuffer: POWERSHELL_MAX_BUFFER, timeout: 10_000 },
    )
    const parsed: unknown = JSON.parse(stdout.trim().length > 0 ? stdout : 'null')
    const rows: RawProcessRow[] = Array.isArray(parsed) ? parsed : parsed ? [parsed as RawProcessRow] : []
    const processes: WindowedProcess[] = rows.map((row) => ({
      pid: Number(row.Id),
      processName: String(row.ProcessName ?? ''),
      windowTitle: String(row.MainWindowTitle ?? ''),
    }))
    return selectWindowedPid(processes, query)
  } catch {
    // Graceful degradation (the package's resilient-by-design posture): a missing
    // or failing PowerShell means we couldn't resolve the pid -> "not found".
    return null
  }
}

/**
 * Is a process with this name running AT ALL — window or not?
 *
 * WHY this exists separately from `findWindowedPidByName`. An app minimized to
 * the SYSTEM TRAY is *hidden*, not minimized: Windows reports
 * `MainWindowHandle = 0` for it, so the windowed lookup above filters it out and
 * every caller concludes "not open". That is false — it is running — and it sent
 * the model down the wrong recovery (launch it? give up?) instead of the one
 * that works. Verified live with Docker Desktop, 2026-08-11: every one of its
 * processes reports handle 0 while the app is plainly running in the tray.
 *
 * Windows genuinely has no restore-from-tray API — a tray icon is a
 * notification-area icon with an app-defined click handler — so knowing the
 * difference is the whole fix: it turns a dead end into "re-launch it".
 */
export async function isProcessRunningByName(query: string): Promise<boolean> {
  if (process.platform !== 'win32') {
    return false
  }
  const trimmed = query.trim()
  if (trimmed.length === 0) return false
  try {
    const { stdout } = await execFileAsync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        // NO MainWindowHandle filter — that omission IS the point. Names only:
        // this answers "is it running", never "what is it doing".
        'Get-Process | Select-Object ProcessName | ConvertTo-Json -Compress',
      ],
      { windowsHide: true, maxBuffer: POWERSHELL_MAX_BUFFER, timeout: 10_000 },
    )
    const parsed: unknown = JSON.parse(stdout.trim().length > 0 ? stdout : 'null')
    const rows: RawProcessRow[] = Array.isArray(parsed)
      ? parsed
      : parsed
        ? [parsed as RawProcessRow]
        : []
    return rows.some((row) => matchesProcessName(String(row.ProcessName ?? ''), trimmed))
  } catch {
    // Same resilient posture as above: a failed probe must not upgrade a real
    // "not open" into a confident "it's in the tray".
    return false
  }
}

/** Loose name match for the running-at-all probe: a process name has no .exe and
 *  often differs from the display name ("Docker Desktop" -> "Docker Desktop"),
 *  so compare case-insensitively in both directions. Pure. */
export function matchesProcessName(processName: string, query: string): boolean {
  const left = processName.trim().toLowerCase()
  const right = query.trim().toLowerCase().replace(/\.exe$/, '')
  // A short fragment must not match half the machine. Bidirectional containment
  // is what makes "Docker Desktop" find process "Docker Desktop" AND query
  // "Docker" find it — but unguarded it also lets "a" match everything, and
  // lets a running `chrome` answer for "Chrome Remote Desktop". The floor is
  // the cheap fix: a confident but WRONG "it's in the system tray" is worse
  // than an honest "not open", because it sends the user hunting a tray icon
  // that isn't there.
  if (left.length < MIN_PROCESS_MATCH_LENGTH || right.length < MIN_PROCESS_MATCH_LENGTH) {
    return false
  }
  return left === right || left.includes(right) || right.includes(left)
}

/** Shortest fragment allowed to claim a process match. Four covers real names
 *  ("Code", "Slack") while rejecting the one- and two-letter queries that would
 *  match nearly any process list. */
export const MIN_PROCESS_MATCH_LENGTH = 4

/**
 * What to tell the model when an app is running but has no window.
 *
 * ONE home because three tools say it (snapshot/act resolution, set_window_state,
 * set_window_bounds) and they must not drift.
 *
 * A previous version of this message declared tray recovery impossible — "for
 * many apps a second launch does nothing because the window was destroyed". That
 * was WRONG, and the way it was wrong is worth keeping. It was inferred from a
 * `launch_app` that ran for 21s and surfaced nothing, and concluded the app was
 * unreachable. The real cause was in `launch-app.ts`: the AppID never reached
 * PowerShell, so the launch opened the Applications folder and reported success.
 * The measurement was of our own bug, not of Windows.
 *
 * Measured again once that was fixed, 2026-08-12: Docker Desktop, hidden in the
 * tray with every process reporting `MainWindowHandle = 0`, came back in ~1
 * second. Shell activation of an already-running app is exactly what clicking
 * its Start-menu entry does, and the app's own handler restores its window.
 *
 * The lesson, not just the fix: never let a tool's silence become a claim about
 * the platform.
 */
export function trayHiddenMessage(query: string, verb: string): string {
  return (
    `"${query}" IS running, but it has no window right now — it is minimized to the system tray ` +
    `(the notification area by the clock), so there is nothing to ${verb} yet. Call launch_app ` +
    'with its installed name: activating an app that is already running is what clicking its ' +
    'Start-menu entry does, and it brings a tray app back. Then retry this call with the window ' +
    'name launch_app reports. If launch_app comes back without a window, STOP and ask the user to ' +
    'click the tray icon — do not keep retrying.'
  )
}
