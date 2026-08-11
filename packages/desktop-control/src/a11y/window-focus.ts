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

import { runPowerShell, type PowerShellRunner } from './powershell.js'
import { restoreIfMinimized } from './window-state.js'

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
  // A MINIMIZED window can't be foregrounded — SetForegroundWindow is a no-op on
  // it — so restore it first. Best-effort and IsIconic-gated (a normal or
  // maximized window is left exactly as it was), so this only ever un-minimizes.
  // This is what lets snapshot_app / act_on_app reach an app the user had
  // minimized, without a separate step (Kafi 2026-08-11).
  await restoreIfMinimized(pid, run)
  await run(activateCommand(pid))
  if (await isForeground(pid, run)) {
    return true
  }
  await run(forceForegroundCommand(pid))
  return isForeground(pid, run)
}
