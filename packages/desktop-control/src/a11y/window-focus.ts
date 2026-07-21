// Window-focus operations for the Electron wake — PowerShell (Windows), NOT
// xa11y. Chromium builds its renderer accessibility tree only after the window
// gains focus, and Windows focus-stealing prevention silently rejects a plain
// `AppActivate` whenever another app holds the foreground. The old recipe
// swallowed that rejection, which is exactly how a Discord snapshot came back
// empty with no clue why. Here focus is OBSERVABLE (activate → verify against
// the real foreground pid) and rejection has a known defeat: an Alt keypress
// immediately before `SetForegroundWindow` (the classic focus-lock release).
//
// Every operation is best-effort — a PowerShell failure degrades to "not
// focused" (the wake loop's deadline handles it), never a thrown boot/turn
// failure. Pure parsers are exported for binary-free tests; the PowerShell
// runner is injectable the same way.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type PowerShellRunner = (command: string) => Promise<string>

// A wedged PowerShell spawn must not hang the caller before any wake deadline
// is even armed — the same never-hang class the probe timeout closes.
const POWERSHELL_TIMEOUT_MS = 10_000

/** Run a PowerShell command, returning stdout — '' on any failure (best-effort). */
export const runPowerShell: PowerShellRunner = async (command) => {
  try {
    const { stdout } = await execFileAsync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { windowsHide: true, timeout: POWERSHELL_TIMEOUT_MS },
    )
    return stdout
  } catch {
    // Best-effort by design — the caller treats '' as "the operation reported
    // nothing", and the wake loop's deadline bounds the consequence.
    return ''
  }
}

/** Parse a PowerShell boolean echo ("True"/"False", any casing, trailing newline). */
export function parseBooleanResult(stdout: string): boolean {
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  return lines[lines.length - 1]?.toLowerCase() === 'true'
}

/** Parse a PowerShell pid echo — null when the output isn't a positive integer. */
export function parseForegroundPid(stdout: string): number | null {
  const trimmed = stdout.trim()
  if (!/^\d+$/.test(trimmed)) {
    return null
  }
  const pid = Number(trimmed)
  return pid > 0 ? pid : null
}

// `$fgPid`, not `$pid` — `$pid` is PowerShell's automatic current-process id.
const FOREGROUND_PID_COMMAND = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class VynelForeground {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
$fgPid = [uint32]0
[void][VynelForeground]::GetWindowThreadProcessId([VynelForeground]::GetForegroundWindow(), [ref]$fgPid)
Write-Output $fgPid
`

function activateCommand(pid: number): string {
  return `Write-Output ((New-Object -ComObject WScript.Shell).AppActivate(${pid}))`
}

// The focus-stealing-prevention defeat: an Alt keypress ('%') makes Windows
// treat this process as "receiving input", which unlocks SetForegroundWindow.
// OWNED side effect: the Alt lands on whatever currently HAS focus, which can
// arm that app's menu bar until its next keypress. Acceptable here — this path
// only runs when moving focus away from that app is the goal, and it fires at
// most once per wake (the retry-once rule in ensureForeground).
function forceForegroundCommand(pid: number): string {
  return `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class VynelFocus {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@
$target = Get-Process -Id ${pid} -ErrorAction SilentlyContinue
if ($target -and $target.MainWindowHandle -ne 0) {
  (New-Object -ComObject WScript.Shell).SendKeys('%')
  Write-Output ([VynelFocus]::SetForegroundWindow($target.MainWindowHandle))
} else {
  Write-Output $false
}
`
}

async function isForeground(pid: number, run: PowerShellRunner): Promise<boolean> {
  return parseForegroundPid(await run(FOREGROUND_PID_COMMAND)) === pid
}

/**
 * Bring a window to the foreground and VERIFY it took: AppActivate → check the
 * real foreground pid → on rejection retry ONCE with the Alt-nudge +
 * `SetForegroundWindow` defeat → re-verify. Returns whether the window is
 * verifiably foreground — a `false` is a *known* focus failure the caller can
 * surface ("click the window once and retry"), never a silent one.
 */
export async function ensureForeground(
  pid: number,
  run: PowerShellRunner = runPowerShell,
): Promise<boolean> {
  await run(activateCommand(pid))
  if (await isForeground(pid, run)) {
    return true
  }
  await run(forceForegroundCommand(pid))
  return isForeground(pid, run)
}
