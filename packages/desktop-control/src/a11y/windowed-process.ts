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
