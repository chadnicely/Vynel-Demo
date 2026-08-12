// Where the mouse pointer actually is.
//
// ⚠ READ THIS BEFORE "SIMPLIFYING" IT TO nut.js. The input engine exposes
// `mouse.getPosition()`, and it is deliberately NOT used here.
//
// It has been measured DISAGREEING with the OS on a fractionally-scaled monitor:
// 2026-08-11, on the 125% panel, it returned (-648,-79) for a cursor Win32
// confirmed was at (-540,113) — off by exactly 1/scaleFactor. It does not always
// disagree; on 2026-08-13 both readers returned (-732,-199) for a cursor on that
// same panel. Which conditions trigger it is NOT established, and this file is
// not the place to find out.
//
// That reader is why the repo once shipped a "DPI bridge" for a bug that did not
// exist: every probe used `getPosition` on BOTH sides of the measurement, so the
// least-squares fit described the READER's error rather than the writer's — and
// it fitted 1/scale beautifully, which made a phantom bug look rigorously
// established. Thirteen green tests encoded the same wrong model. The fix was
// reverted; the lesson was not: never measure an actuator with its own sensor,
// and prefer the independent witness even when the convenient one agrees today.
//
// Win32 `GetCursorPos` is that witness. It reports in the same virtual-desktop
// frame as `list_monitors`' bounds, so a position here is directly comparable to
// a monitor rectangle.

import { runPowerShell, type PowerShellRunner } from '../a11y/powershell.js'

export type CursorPosition = { x: number; y: number }

const CURSOR_POSITION_COMMAND = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class VynelCursor {
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out P p);
  public struct P { public int X; public int Y; }
}
"@
$point = New-Object VynelCursor+P
if ([VynelCursor]::GetCursorPos([ref]$point)) { Write-Output "$($point.X),$($point.Y)" }
`

/**
 * Parse the `x,y` echo. Null on anything else — a cursor position we are not
 * sure of is worse than none, because the model would aim with it.
 *
 * NEGATIVE values are valid and must survive: a monitor left of or above the
 * primary has a negative origin, and rejecting those would make the pointer
 * unreportable on exactly the second-monitor setups this exists for. Pure.
 */
export function parseCursorPosition(stdout: string): CursorPosition | null {
  const matched = /^(-?\d+),(-?\d+)$/.exec(stdout.trim())
  if (matched === null) return null
  const x = Number(matched[1])
  const y = Number(matched[2])
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
}

/** Read the pointer position. Null when it can't be read (off-Windows, or a
 *  PowerShell failure) — the caller says so rather than guessing. */
export async function readCursorPosition(
  run: PowerShellRunner = runPowerShell,
): Promise<CursorPosition | null> {
  if (process.platform !== 'win32') return null
  return parseCursorPosition(await run(CURSOR_POSITION_COMMAND))
}
