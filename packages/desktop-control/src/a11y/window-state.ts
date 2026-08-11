// Window-state operations — restore / maximize / minimize a window by pid, via
// Win32 `ShowWindow` (PowerShell, NOT xa11y). Two callers:
//   - `restoreIfMinimized` is the AUTOMATIC helper: `ensureForeground` and
//     `screenshot_app` call it so a minimized app can be reached without a
//     separate step. IsIconic-gated — it only ever UN-minimizes, never touches
//     a normal or maximized window.
//   - `setWindowState` is the EXPLICIT lever behind the `set_window_state` tool
//     (maximize to make an app usable, minimize to clear it away, restore to
//     normal). It applies the requested state unconditionally.
//
// Best-effort like `window-focus.ts`: a PowerShell failure degrades to `false`
// (the caller surfaces an honest "couldn't"), never a thrown turn failure. Pure
// helpers are exported for binary-free tests; the runner is injectable.

import { runPowerShell, parseBooleanResult, type PowerShellRunner } from './powershell.js'

export const WINDOW_STATES = ['restored', 'maximized', 'minimized'] as const
export type WindowState = (typeof WINDOW_STATES)[number]

export function isWindowState(value: unknown): value is WindowState {
  return typeof value === 'string' && (WINDOW_STATES as readonly string[]).includes(value)
}

// Win32 ShowWindow command constants.
const SW_MINIMIZE = 6
const SW_MAXIMIZE = 3
const SW_RESTORE = 9

const SHOW_COMMAND_BY_STATE: Record<WindowState, number> = {
  restored: SW_RESTORE,
  maximized: SW_MAXIMIZE,
  minimized: SW_MINIMIZE,
}

/** Human sentence for the tool response + overlay narration. */
export function windowStateVerb(state: WindowState): string {
  switch (state) {
    case 'restored':
      return 'restored'
    case 'maximized':
      return 'maximized'
    case 'minimized':
      return 'minimized'
  }
}

// The Win32 interop preamble — ShowWindow + IsIconic against a pid's main
// window handle. `$h -ne 0` guards a process with no window.
//
// The echo is the VERIFIED END STATE, not "the call ran": `wantIconic` says
// which end state counts as success, so a minimize reports true when the window
// really is iconic and a restore reports true when it really isn't. Echoing a
// bare `-not IsIconic` would have made a successful minimize look like a
// failure — an ambiguity a caller cannot recover from.
//
// The gate (`onlyIfMinimized`) skips the ShowWindow call but NOT the check, so
// a window that was already in the wanted state still reports true.
//
// KNOWN LIMIT: the handle is the process's MainWindowHandle. For an app with
// several top-level windows (two Chrome windows, two Explorer windows), a
// minimized NON-main window can't be reached this way — the caller surfaces the
// honest "couldn't restore" rather than silently acting on the wrong window.
// Fixing it needs a real HWND, which the capture binding doesn't expose.
function showWindowCommand(
  pid: number,
  showCommand: number,
  options: { onlyIfMinimized: boolean; wantIconic: boolean },
): string {
  const gate = options.onlyIfMinimized ? '[VynelWindow]::IsIconic($h)' : '$true'
  const wanted = options.wantIconic ? '$true' : '$false'
  return `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class VynelWindow {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
}
"@
$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue
$h = if ($p) { $p.MainWindowHandle } else { [IntPtr]::Zero }
if ($h -ne 0) {
  if (${gate}) {
    [void][VynelWindow]::ShowWindow($h, ${showCommand})
    Start-Sleep -Milliseconds 150
  }
  Write-Output ([VynelWindow]::IsIconic($h) -eq ${wanted})
} else {
  Write-Output $false
}
`
}

/**
 * Restore a window ONLY if it is currently minimized (IsIconic-gated) — a
 * normal or maximized window is left exactly as the user had it. (SW_RESTORE on
 * a maximized-then-minimized window correctly returns it to MAXIMIZED, which is
 * why it beats SW_SHOWNORMAL here.)
 *
 * Returns whether the window is verifiably non-minimized afterward — `true` for
 * a window that was never minimized, `false` when the process has no reachable
 * window or the restore didn't take. The short in-script sleep lets the
 * compositor settle so a follow-up screenshot/focus sees the restored window
 * rather than a mid-animation frame.
 */
export async function restoreIfMinimized(
  pid: number,
  run: PowerShellRunner = runPowerShell,
): Promise<boolean> {
  return parseBooleanResult(
    await run(showWindowCommand(pid, SW_RESTORE, { onlyIfMinimized: true, wantIconic: false })),
  )
}

/**
 * Apply a window state unconditionally (the explicit tool's op). Returns
 * whether the window VERIFIABLY reached the requested state — including a
 * successful minimize, so a caller can report honestly instead of assuming.
 */
export async function setWindowState(
  pid: number,
  state: WindowState,
  run: PowerShellRunner = runPowerShell,
): Promise<boolean> {
  return parseBooleanResult(
    await run(
      showWindowCommand(pid, SHOW_COMMAND_BY_STATE[state], {
        onlyIfMinimized: false,
        wantIconic: state === 'minimized',
      }),
    ),
  )
}
