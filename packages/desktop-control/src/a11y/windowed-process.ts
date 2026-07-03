// OS window/process helpers for the a11y adapter's Electron fallback. Touches
// PowerShell (Windows), NOT xa11y — so `xa11y-adapter.ts` stays the single
// xa11y touchpoint. Used when xa11y's UIA enumeration can't see an app: Electron
// apps (Discord, Slack, …) don't appear in `App.list()`, but their main window
// IS a real OS process we can reach by pid via `App.byPid`.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const POWERSHELL_MAX_BUFFER = 4 * 1024 * 1024

export type WindowedProcess = { pid: number; processName: string; windowTitle: string }

/**
 * Pick the windowed process whose process name OR window title matches the query
 * (case-insensitive substring) — same matching shape as `isAppNameMatch`, so the
 * model targets "Discord" without the exact title. Pure (no I/O) for testing.
 */
export function selectWindowedPid(processes: WindowedProcess[], query: string): number | null {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) {
    return null
  }
  const match = processes.find(
    (candidate) =>
      candidate.processName.toLowerCase().includes(needle) ||
      candidate.windowTitle.toLowerCase().includes(needle),
  )
  return match ? match.pid : null
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
      { windowsHide: true, maxBuffer: POWERSHELL_MAX_BUFFER },
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
 * Bring a window to the foreground by pid — a focus event that prompts Chromium
 * to build its renderer accessibility tree (part of the Electron wake recipe).
 * Best-effort and Windows-only; focus-stealing prevention may reject it.
 */
export async function foregroundWindow(pid: number): Promise<void> {
  if (process.platform !== 'win32') {
    return
  }
  try {
    await execFileAsync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', `(New-Object -ComObject WScript.Shell).AppActivate(${pid})`],
      { windowsHide: true },
    )
  } catch {
    // Best-effort; the subscription alone may still wake the tree.
  }
}
