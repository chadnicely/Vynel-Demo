// The system screen-reader flag (`SystemParametersInfo(SPI_SETSCREENREADER)`) —
// the missing half of the Electron wake. A held UIA subscription makes
// `UiaClientsAreListening()` true, but Chromium additionally keys the decision
// to build its FULL web-contents accessibility tree off screen-reader
// detection; without this flag a woken Discord can still expose only its frame.
// Set at wake start, cleared when the last concurrent wake releases
// (refcounted — concurrent snapshots must not clear it under each other).
//
// This mutates a GLOBAL OS setting from a read op — deliberate, reversible, and
// scoped to the wake window. Residual risk: a crash mid-wake leaves the flag
// set until the next wake cycle sets-then-clears it (self-healing on next use).
// Best-effort throughout: a PowerShell failure degrades to "flag not set" and
// the wake proceeds on the subscription alone.

import { runPowerShell, type PowerShellRunner } from './powershell.js'

// SPI_SETSCREENREADER = 0x0047; SPIF_SENDCHANGE = 2 (broadcast the change so
// running apps — Chromium — re-read it).
function screenReaderCommand(on: boolean): string {
  return `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class VynelSpi {
  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool SystemParametersInfo(uint uiAction, uint uiParam, IntPtr pvParam, uint fWinIni);
}
"@
[void][VynelSpi]::SystemParametersInfo(0x0047, ${on ? 1 : 0}, [IntPtr]::Zero, 2)
`
}

export type ScreenReaderFlagHolder = {
  /** Set the flag (first holder) and return a release; the last release clears it. */
  acquire(): Promise<() => void>
}

export function createScreenReaderFlagHolder(
  run: PowerShellRunner = runPowerShell,
): ScreenReaderFlagHolder {
  let holds = 0
  return {
    async acquire(): Promise<() => void> {
      holds += 1
      if (holds === 1) {
        try {
          await run(screenReaderCommand(true))
        } catch (setError) {
          // A throwing runner must not strand the count — later acquires would
          // skip the set forever (no release handle ever escaped here).
          holds -= 1
          throw setError
        }
      }
      let released = false
      return () => {
        // Idempotent — a double release (dispose called twice) must not
        // decrement another holder's count.
        if (released) return
        released = true
        holds -= 1
        if (holds === 0) {
          // Fire-and-forget: a clear racing a fresh acquire's set can in theory
          // land after it. Accepted — the window is one PowerShell spawn wide,
          // and the next wake cycle re-sets the flag anyway (self-healing).
          void run(screenReaderCommand(false))
        }
      }
    },
  }
}

/** The process-wide holder every wake shares (one OS flag, one refcount). */
export const screenReaderFlag = createScreenReaderFlagHolder()
