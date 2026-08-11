// Move and resize a window — Win32 `SetWindowPos` over PowerShell, the same
// shape as `window-state.ts`'s `ShowWindow`.
//
// WHY this is the primitive and NOT a drag. "Put Chrome on my other screen" is
// a rectangle assignment, not a gesture: dragging a title bar across a monitor
// boundary is slow, can drop mid-flight, and fails in a way that looks exactly
// like nothing happened. Assigning bounds is instant, verifiable, and cannot
// half-succeed. The drag primitive stays for what it is genuinely for —
// drag-and-drop inside an app.
//
// WHY PowerShell rather than a window-management library: `node-screenshots`
// reads geometry but cannot set it, and we already reach Win32 this way for
// ShowWindow — a whole new native dependency to gain one call is not worth the
// install surface.
//
// ⚠ DPI: this script declares itself PER-MONITOR DPI AWARE before calling
// SetWindowPos, so the coordinates it accepts are the same virtual-desktop
// pixels `list_monitors` and the window bounds report. Without that declaration
// Windows silently virtualizes coordinates for a scaled display and the window
// lands somewhere else — the exact class of bug the DPI retraction was about.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const SET_BOUNDS_TIMEOUT_MS = 15_000

export interface WindowBoundsRequest {
  x: number
  y: number
  width: number
  height: number
}

/** Smallest window we will ask for. Windows enforces its own minimums anyway;
 *  this stops an obvious mistake (a 2px window the user then cannot grab). */
export const MIN_WINDOW_EDGE_PX = 120

/** Reject a rectangle that would strand the window before we touch anything.
 *  Negative x/y are VALID — a monitor left of or above the primary lives there —
 *  so only the size is floored. Pure; returns null when acceptable. */
export function rejectUnusableBounds(bounds: WindowBoundsRequest): string | null {
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) {
    return 'x, y, width and height must all be numbers.'
  }
  if (bounds.width < MIN_WINDOW_EDGE_PX || bounds.height < MIN_WINDOW_EDGE_PX) {
    return (
      `A window smaller than ${MIN_WINDOW_EDGE_PX}px on a side would be unusable — and the user ` +
      'would struggle to grab it back. Ask for a larger size.'
    )
  }
  return null
}

function setBoundsCommand(pid: number, bounds: WindowBoundsRequest): string {
  // SWP_NOZORDER (0x4) | SWP_NOACTIVATE (0x10): move it WITHOUT yanking focus
  // away from whatever the user is typing in. Arranging a window is not a
  // reason to steal the foreground.
  return `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class VynelBounds {
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("shcore.dll")] public static extern int SetProcessDpiAwareness(int v);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
try { [void][VynelBounds]::SetProcessDpiAwareness(2) } catch {}
$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue
$h = if ($p) { $p.MainWindowHandle } else { [IntPtr]::Zero }
if ($h -ne 0) {
  [void][VynelBounds]::SetWindowPos($h, [IntPtr]::Zero, ${bounds.x}, ${bounds.y}, ${bounds.width}, ${bounds.height}, 0x14)
  Start-Sleep -Milliseconds 150
  $r = New-Object VynelBounds+RECT
  [void][VynelBounds]::GetWindowRect($h, [ref]$r)
  Write-Output ("$($r.Left),$($r.Top),$($r.Right - $r.Left),$($r.Bottom - $r.Top)")
} else {
  Write-Output "NOWINDOW"
}
`
}

export type SetWindowBoundsOutcome =
  | { ok: true; applied: WindowBoundsRequest }
  | { ok: false; reason: 'no-window' | 'failed' }

/** Parse the script's echo. Pure, so the "did it land" reading is testable
 *  without a desktop. */
export function parseBoundsEcho(stdout: string): SetWindowBoundsOutcome {
  const line = stdout.trim().split(/\r?\n/).pop() ?? ''
  if (line === 'NOWINDOW') return { ok: false, reason: 'no-window' }
  const parts = line.split(',').map((part) => Number(part.trim()))
  if (parts.length !== 4 || !parts.every(Number.isFinite)) return { ok: false, reason: 'failed' }
  return {
    ok: true,
    applied: { x: parts[0]!, y: parts[1]!, width: parts[2]!, height: parts[3]! },
  }
}

/**
 * Move/resize the pid's main window, returning the rectangle it ACTUALLY ended
 * up at.
 *
 * The verified echo matters: an app may clamp what it accepts (a minimum size,
 * a snapped position), and reporting the requested rectangle would have the
 * model build its next step — a click at some coordinate — on a fiction. Same
 * reasoning as `set_window_state` reporting its verified end state.
 */
export async function setWindowBounds(
  pid: number,
  bounds: WindowBoundsRequest,
): Promise<SetWindowBoundsOutcome> {
  if (process.platform !== 'win32') return { ok: false, reason: 'failed' }
  try {
    const { stdout } = await execFileAsync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', setBoundsCommand(pid, bounds)],
      { windowsHide: true, timeout: SET_BOUNDS_TIMEOUT_MS },
    )
    return parseBoundsEcho(stdout)
  } catch {
    // Same resilient posture as the rest of the package: a failed spawn is a
    // failed move, never a crash mid-turn.
    return { ok: false, reason: 'failed' }
  }
}
