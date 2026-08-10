// The INSTALLED-app roster — what's on the machine, whether or not it's
// running. The counterpart to `a11y/xa11y-adapter.ts`'s `listOpenApps` (what's
// open right now): without this, "open Chrome and search YouTube" dead-ends
// the moment Chrome isn't already running, because every other primitive in
// this package addresses a live window.
//
// Source: PowerShell `Get-StartApps`, the Start-menu roster Windows itself
// shows the user. It covers Win32 and packaged (UWP) apps in one list and hands
// back the AppID that `shell:AppsFolder` can launch — so the thing we list is
// exactly the thing we can start, with no path guessing. Same best-effort
// posture as the rest of the package: off-Windows or on a PowerShell failure
// the roster is empty rather than throwing.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const POWERSHELL_MAX_BUFFER = 4 * 1024 * 1024
const POWERSHELL_TIMEOUT_MS = 15_000

/** One installed app: the name a person reads, and the id Windows launches. */
export type InstalledApp = {
  name: string
  /** The `Get-StartApps` AppID — a UWP AUMID or a Win32 shell-folder id. */
  appId: string
}

type RawStartApp = { Name?: unknown; AppID?: unknown }

/**
 * Parse `Get-StartApps | ConvertTo-Json` output. Pure + exported so the shape
 * handling is testable without Windows. PowerShell collapses a single-row
 * result to an object (not an array) — the classic trap this normalizes.
 * Rows missing a name or an id are dropped: an app we can't name is useless to
 * the model, and one we can't launch would be a promise we can't keep.
 */
export function parseInstalledApps(stdout: string): InstalledApp[] {
  const trimmed = stdout.trim()
  if (trimmed.length === 0) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return []
  }
  const rows: RawStartApp[] = Array.isArray(parsed)
    ? (parsed as RawStartApp[])
    : parsed !== null && typeof parsed === 'object'
      ? [parsed as RawStartApp]
      : []
  const seen = new Set<string>()
  const apps: InstalledApp[] = []
  for (const row of rows) {
    const name = typeof row.Name === 'string' ? row.Name.trim() : ''
    const appId = typeof row.AppID === 'string' ? row.AppID.trim() : ''
    if (name.length === 0 || appId.length === 0) continue
    // The Start menu can list the same AppID twice (a folder + a root entry).
    if (seen.has(appId)) continue
    seen.add(appId)
    apps.push({ name, appId })
  }
  return apps
}

/** Rank installed apps against a query — exact name first, then prefix, then
 *  substring; ties break to the shortest name ("Chrome" over "Chrome Canary").
 *  Pure; the caller decides what to do with an ambiguous result. */
export function matchInstalledApps(apps: InstalledApp[], query: string): InstalledApp[] {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return []
  const scored: Array<{ app: InstalledApp; rank: number }> = []
  for (const app of apps) {
    const name = app.name.toLowerCase()
    const rank = name === needle ? 0 : name.startsWith(needle) ? 1 : name.includes(needle) ? 2 : -1
    if (rank >= 0) scored.push({ app, rank })
  }
  return scored
    .sort((a, b) => a.rank - b.rank || a.app.name.length - b.app.name.length)
    .map((entry) => entry.app)
}

export type ListInstalledAppsDeps = {
  /** Injectable for tests — production shells out to PowerShell. */
  runPowerShell?: (command: string) => Promise<string>
}

const LIST_COMMAND = 'Get-StartApps | Select-Object Name, AppID | ConvertTo-Json -Compress'

async function runListCommand(command: string): Promise<string> {
  if (process.platform !== 'win32') return ''
  try {
    const { stdout } = await execFileAsync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { windowsHide: true, maxBuffer: POWERSHELL_MAX_BUFFER, timeout: POWERSHELL_TIMEOUT_MS },
    )
    return stdout
  } catch {
    // Best-effort, like every other PowerShell path here: an empty roster reads
    // as "couldn't see any installed apps", never a thrown turn failure.
    return ''
  }
}

/** Every app in the Start menu. Empty off-Windows or when PowerShell fails. */
export async function listInstalledApps(deps: ListInstalledAppsDeps = {}): Promise<InstalledApp[]> {
  const run = deps.runPowerShell ?? runListCommand
  return parseInstalledApps(await run(LIST_COMMAND))
}
